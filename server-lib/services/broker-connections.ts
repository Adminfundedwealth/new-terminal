import { getSupabaseClient } from "../supabase/client.js";
import { decryptCredentials } from "../security/broker-encryption.js";
import { MarketDataProviderError } from "../brokers/provider-error.js";
import type { BrokerCredentialMap } from "../brokers/types.js";

export interface BrokerConnectionScope {
  broker_id: "dhan" | "zerodha";
  environment: "production" | "paper";
}

/**
 * Looks up the active broker connection for a trading account and returns decrypted credentials.
 * This is the server-side credential lookup function used by all broker endpoints.
 * 
 * @param tradingAccountId - The trading account UUID
 * @param scope - Broker ID and environment to filter by
 * @returns Decrypted credential map
 * @throws MarketDataProviderError with code MISSING_CREDENTIALS if no active connection found
 */
export async function getCentralCredentialsForAccount(
  tradingAccountId: string,
  scope: BrokerConnectionScope
): Promise<BrokerCredentialMap> {
  const db = getSupabaseClient();

  // Step 1: Find the active broker connection binding for this trading account
  const { data: binding, error: bindingError } = await db
    .from("trading_account_broker_connections")
    .select("broker_connection_id")
    .eq("trading_account_id", tradingAccountId)
    .eq("is_active", true)
    .maybeSingle();

  if (bindingError || !binding) {
    throw new MarketDataProviderError(
      scope.broker_id === "dhan" ? "dhan" : "kite",
      "MISSING_CREDENTIALS"
    );
  }

  // Step 2: Load the broker connection with encrypted credentials
  const { data: connection, error: connectionError } = await db
    .from("broker_connections")
    .select("encrypted_credentials, is_active, is_connected")
    .eq("id", binding.broker_connection_id)
    .eq("broker_id", scope.broker_id)
    .eq("environment", scope.environment)
    .maybeSingle();

  if (connectionError || !connection) {
    throw new MarketDataProviderError(
      scope.broker_id === "dhan" ? "dhan" : "kite",
      "MISSING_CREDENTIALS"
    );
  }

  if (!connection.is_active || !connection.is_connected) {
    throw new MarketDataProviderError(
      scope.broker_id === "dhan" ? "dhan" : "kite",
      "MISSING_CREDENTIALS"
    );
  }

  // Step 3: Decrypt credentials server-side
  try {
    return decryptCredentials(connection.encrypted_credentials);
  } catch (error) {
    console.error("Failed to decrypt broker credentials:", error);
    throw new MarketDataProviderError(
      scope.broker_id === "dhan" ? "dhan" : "kite",
      "INVALID_CREDENTIALS"
    );
  }
}

/**
 * Looks up broker connection by ID directly (for connection test endpoint)
 */
export async function getBrokerConnectionById(
  connectionId: string,
  scope: BrokerConnectionScope
): Promise<{ credentials: BrokerCredentialMap; connection: any }> {
  const db = getSupabaseClient();

  const { data: connection, error } = await db
    .from("broker_connections")
    .select("*")
    .eq("id", connectionId)
    .eq("broker_id", scope.broker_id)
    .eq("environment", scope.environment)
    .maybeSingle();

  if (error || !connection) {
    throw new MarketDataProviderError(
      scope.broker_id === "dhan" ? "dhan" : "kite",
      "MISSING_CREDENTIALS"
    );
  }

  try {
    const credentials = decryptCredentials(connection.encrypted_credentials);
    return { credentials, connection };
  } catch (error) {
    console.error("Failed to decrypt broker credentials:", error);
    throw new MarketDataProviderError(
      scope.broker_id === "dhan" ? "dhan" : "kite",
      "INVALID_CREDENTIALS"
    );
  }
}
