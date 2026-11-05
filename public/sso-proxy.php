<?php
$route = $_GET['route'] ?? '';
$method = $_SERVER['REQUEST_METHOD'] ?? '';
$host = strtolower(trim($_SERVER['HTTP_HOST'] ?? ''));
$isHttps = (!empty($_SERVER['HTTPS']) && strtolower((string) $_SERVER['HTTPS']) !== 'off')
    || (string) ($_SERVER['SERVER_PORT'] ?? '') === '443';

function respondJson(int $status, array $body): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($body, JSON_UNESCAPED_SLASHES);
    exit;
}

function isChartHost(string $host, bool $isHttps): bool
{
    return $isHttps && in_array($host, ['charts.fundedwealth.com', 'charts.fundedwealth.com:443'], true);
}

function isTrustedChartUrl(string $value, bool $allowPath): bool
{
    $parts = parse_url($value);
    return is_array($parts)
        && ($parts['scheme'] ?? '') === 'https'
        && strtolower($parts['host'] ?? '') === 'charts.fundedwealth.com'
        && ($parts['port'] ?? 443) === 443
        && !isset($parts['user'])
        && !isset($parts['pass'])
        && ($allowPath || !isset($parts['path']) || $parts['path'] === '' || $parts['path'] === '/');
}

function hasTrustedChartOrigin(): bool
{
    $origin = trim($_SERVER['HTTP_ORIGIN'] ?? '');
    $referer = trim($_SERVER['HTTP_REFERER'] ?? '');
    $trustedOrigin = $origin !== '' && isTrustedChartUrl($origin, false);
    $trustedReferer = $referer !== '' && isTrustedChartUrl($referer, true);

    return !($origin !== '' && !$trustedOrigin)
        && !($referer !== '' && !$trustedReferer)
        && ($trustedOrigin || $trustedReferer);
}

function readFormBody(): ?array
{
    $contentType = strtolower(trim(explode(';', $_SERVER['CONTENT_TYPE'] ?? '')[0]));
    if ($contentType !== 'application/x-www-form-urlencoded') {
        return null;
    }

    $body = file_get_contents('php://input', false, null, 0, 8193);
    if ($body === false || strlen($body) > 8192) {
        return null;
    }

    parse_str($body, $form);
    return is_array($form) ? $form : null;
}

function startExchangeSession(): bool
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return true;
    }

    session_name('FWSSO');
    ini_set('session.use_only_cookies', '1');
    ini_set('session.use_strict_mode', '1');
    session_set_cookie_params([
        'lifetime' => 90,
        'path' => '/auth/sso',
        'secure' => true,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);

    return session_start();
}

function clearExchangeSession(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        $_SESSION = [];
        session_destroy();
    }
    setcookie('FWSSO', '', [
        'expires' => time() - 3600,
        'path' => '/auth/sso',
        'secure' => true,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
}

if (!in_array($route, ['sso', 'store', 'exchange'], true) || !$isHttps || !$host) {
    http_response_code(404);
    header('Cache-Control: no-store');
    exit;
}

if (!isChartHost($host, $isHttps)) {
    respondJson(403, ['error' => 'The SSO host is not allowed.']);
}

if ($route === 'sso') {
    if ($method !== 'POST') {
        http_response_code(404);
        header('Cache-Control: no-store');
        exit;
    }

    $form = readFormBody();
    $token = is_array($form) && is_string($form['token'] ?? null) ? $form['token'] : '';
    if ($token === '' || strlen($token) > 2048 || !preg_match('/^[A-Za-z0-9._~-]+$/D', $token)) {
        respondJson(400, ['error' => 'A valid SSO handoff is required.']);
    }

    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    header("Content-Security-Policy: default-src 'none'; script-src 'self'; connect-src 'self' https://new-terminal-production.up.railway.app; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    $escapedToken = htmlspecialchars($token, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    echo '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="referrer" content="same-origin"><title>Signing in to terminal</title></head><body><p id="sso-status" role="status" aria-live="polite">Connecting to the terminal...</p><form id="sso-handoff" hidden><input name="token" value="' . $escapedToken . '"></form><script src="/sso-bootstrap.js" defer></script></body></html>';
    exit;
}

if ($route === 'store') {
    if ($method !== 'POST') {
        http_response_code(404);
        header('Cache-Control: no-store');
        exit;
    }
    if (!hasTrustedChartOrigin()) {
        respondJson(403, ['error' => 'The SSO exchange origin is not allowed.']);
    }

    $form = readFormBody();
    $tokenHash = is_array($form) && is_string($form['tokenHash'] ?? null) ? $form['tokenHash'] : '';
    $accountId = is_array($form) && is_string($form['accountId'] ?? null) ? $form['accountId'] : '';
    if ($tokenHash === '' || strlen($tokenHash) > 1024 || !preg_match('/^[\x21-\x7E]+$/D', $tokenHash)
        || $accountId === '' || strlen($accountId) > 128 || !preg_match('/^[\x21-\x7E]+$/D', $accountId)) {
        respondJson(400, ['error' => 'The terminal returned an invalid sign-in handoff.']);
    }

    if (!startExchangeSession() || !session_regenerate_id(true)) {
        respondJson(503, ['error' => 'The terminal sign-in session is unavailable.']);
    }
    $_SESSION['fw_sso_exchange'] = [
        'tokenHash' => $tokenHash,
        'accountId' => $accountId,
        'expiresAt' => time() + 90,
    ];
    session_write_close();
    http_response_code(204);
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    exit;
}

if ($method !== 'GET') {
    http_response_code(404);
    header('Cache-Control: no-store');
    exit;
}
if (!hasTrustedChartOrigin()) {
    respondJson(403, ['error' => 'The SSO exchange origin is not allowed.']);
}
if (!startExchangeSession()) {
    respondJson(503, ['error' => 'The terminal sign-in session is unavailable.']);
}

$exchange = $_SESSION['fw_sso_exchange'] ?? null;
clearExchangeSession();
if (!is_array($exchange)
    || !is_string($exchange['tokenHash'] ?? null)
    || !is_string($exchange['accountId'] ?? null)
    || !is_int($exchange['expiresAt'] ?? null)
    || $exchange['expiresAt'] <= time()) {
    respondJson(401, ['error' => 'The one-time SSO exchange is missing or expired.']);
}

http_response_code(200);
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
echo json_encode([
    'tokenHash' => $exchange['tokenHash'],
    'accountId' => $exchange['accountId'],
], JSON_UNESCAPED_SLASHES);
