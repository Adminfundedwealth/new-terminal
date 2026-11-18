import { spawn } from "node:child_process";
import { resolve } from "node:path";

const TEST_APPLICATION_NAME = "fundedwealth-execution-test";
const TEST_DATABASE_ENV = "EXECUTION_TEST_DATABASE_URL";
const SQL_FILES = [
  "supabase/tests/task_d4_synthetic_setup.sql",
  "supabase/tests/task_d4_assertions.sql",
  "supabase/tests/task_d4_cleanup.sql",
];
const CONCURRENT_CLAIM_FILE = "supabase/tests/task_d4_concurrent_claim.sql";

function localDatabaseConfig() {
  const rawUrl = process.env[TEST_DATABASE_ENV];
  if (!rawUrl) {
    throw new Error(`${TEST_DATABASE_ENV} must point to a local Supabase test database.`);
  }

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`${TEST_DATABASE_ENV} is not a valid PostgreSQL URL.`);
  }

  const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !loopbackHosts.has(url.hostname)
    || url.port !== "54322"
    || url.pathname !== "/postgres"
    || decodeURIComponent(url.username || "postgres") !== "postgres"
    || url.search
    || url.hash) {
    throw new Error(
      `${TEST_DATABASE_ENV} must use local Supabase at localhost:54322/postgres; remote database URLs are refused.`,
    );
  }

  return {
    host: url.hostname.replace(/^\[|\]$/g, ""),
    port: url.port,
    database: url.pathname.slice(1),
    username: decodeURIComponent(url.username || "postgres"),
    password: decodeURIComponent(url.password),
  };
}

function psqlEnvironment(config) {
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (/^PG[A-Z0-9_]*$/i.test(name)) delete env[name];
  }
  for (const name of [
    "DATABASE_URL", "SUPABASE_DB_URL", "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ANON_KEY",
    "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    TEST_DATABASE_ENV,
  ]) {
    delete env[name];
  }
  Object.assign(env, {
    PGHOST: config.host,
    PGPORT: config.port,
    PGDATABASE: config.database,
    PGUSER: config.username,
    PGPASSWORD: config.password,
    PGAPPNAME: TEST_APPLICATION_NAME,
    PGSSLMODE: "disable",
  });
  return env;
}

function runSqlFile(file, env) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      "psql",
      ["--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--file", resolve(file)],
      { env, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.once("error", rejectPromise);
    child.once("close", (code) => {
      if (code !== 0) {
        rejectPromise(new Error(`${file} failed (${code ?? "no exit code"}):\n${stderr || stdout}`));
        return;
      }
      if (stdout.trim()) process.stdout.write(stdout);
      resolvePromise();
    });
  });
}

async function main() {
  const env = psqlEnvironment(localDatabaseConfig());
  let setupComplete = false;
  let testFailure = null;
  let cleanupFailure = null;

  try {
    await runSqlFile(SQL_FILES[0], env);
    setupComplete = true;
    await Promise.all([
      runSqlFile(CONCURRENT_CLAIM_FILE, env),
      runSqlFile(CONCURRENT_CLAIM_FILE, env),
    ]);
    await runSqlFile(SQL_FILES[1], env);
    console.log("Isolated durable execution database tests passed.");
  } catch (error) {
    testFailure = error;
  } finally {
    if (setupComplete) {
      try {
        await runSqlFile(SQL_FILES[2], env);
      } catch (error) {
        cleanupFailure = error;
      }
    }
  }

  if (testFailure) throw testFailure;
  if (cleanupFailure) throw cleanupFailure;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Execution database tests failed.");
  process.exitCode = 1;
});
