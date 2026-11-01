<?php
$apiOrigin = 'https://new-terminal-production.up.railway.app';
$route = $_GET['route'] ?? '';
$routes = [
    'sso' => ['path' => '/auth/sso', 'method' => 'POST'],
    'exchange' => ['path' => '/auth/sso/exchange', 'method' => 'GET'],
];

if (!isset($routes[$route]) || $_SERVER['REQUEST_METHOD'] !== $routes[$route]['method']) {
    http_response_code(404);
    header('Cache-Control: no-store');
    exit;
}

if (!function_exists('curl_init')) {
    http_response_code(503);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo '{"error":"SSO proxy is unavailable."}';
    exit;
}

$forwardHeaders = ['Accept: application/json'];
$contentType = $_SERVER['CONTENT_TYPE'] ?? '';
if ($route === 'sso') {
    $forwardHeaders[] = 'Content-Type: ' . $contentType;
}
if ($route === 'exchange') {
    $host = strtolower(trim($_SERVER['HTTP_HOST'] ?? ''));
    $isHttps = (!empty($_SERVER['HTTPS']) && strtolower((string) $_SERVER['HTTPS']) !== 'off')
        || (string) ($_SERVER['SERVER_PORT'] ?? '') === '443';
    if (!$isHttps || !in_array($host, ['charts.fundedwealth.com', 'charts.fundedwealth.com:443'], true)) {
        http_response_code(403);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        echo '{"error":"SSO exchange host is not allowed."}';
        exit;
    }

    $isTrustedUrl = static function (string $value, bool $allowPath): bool {
        $parts = parse_url($value);
        return is_array($parts)
            && ($parts['scheme'] ?? '') === 'https'
            && strtolower($parts['host'] ?? '') === 'charts.fundedwealth.com'
            && ($parts['port'] ?? 443) === 443
            && !isset($parts['user'])
            && !isset($parts['pass'])
            && ($allowPath || !isset($parts['path']) || $parts['path'] === '' || $parts['path'] === '/');
    };
    $origin = trim($_SERVER['HTTP_ORIGIN'] ?? '');
    $referer = trim($_SERVER['HTTP_REFERER'] ?? '');
    $trustedOrigin = $origin !== '' && $isTrustedUrl($origin, false);
    $trustedReferer = $referer !== '' && $isTrustedUrl($referer, true);

    if (($origin !== '' && !$trustedOrigin)
        || ($referer !== '' && !$trustedReferer)
        || (!$trustedOrigin && !$trustedReferer)) {
        http_response_code(403);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        echo '{"error":"SSO exchange origin is not allowed."}';
        exit;
    }

    $forwardHeaders[] = 'Origin: https://charts.fundedwealth.com';
    $forwardHeaders[] = 'Referer: https://charts.fundedwealth.com/';
} elseif (isset($_SERVER['HTTP_ORIGIN'])) {
    $forwardHeaders[] = 'Origin: ' . $_SERVER['HTTP_ORIGIN'];
}
if ($route === 'exchange' && isset($_COOKIE['fw_sso_exchange'])) {
    $forwardHeaders[] = 'Cookie: fw_sso_exchange=' . $_COOKIE['fw_sso_exchange'];
}

$responseHeaders = [];
$curl = curl_init($apiOrigin . $routes[$route]['path']);
curl_setopt_array($curl, [
    CURLOPT_CUSTOMREQUEST => $routes[$route]['method'],
    CURLOPT_HTTPHEADER => $forwardHeaders,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => false,
    CURLOPT_CONNECTTIMEOUT_MS => 3000,
    CURLOPT_TIMEOUT_MS => 10000,
    CURLOPT_HEADERFUNCTION => static function ($handle, $line) use (&$responseHeaders) {
        $length = strlen($line);
        $parts = explode(':', $line, 2);
        if (count($parts) === 2) {
            $name = strtolower(trim($parts[0]));
            $value = trim($parts[1]);
            if ($name === 'set-cookie' && str_starts_with($value, 'fw_sso_exchange=')) {
                $responseHeaders['set-cookie'][] = $value;
            } elseif ($name === 'location' && $value === '/auth/sso/complete') {
                $responseHeaders['location'] = $value;
            } elseif ($name === 'cache-control' && str_contains(strtolower($value), 'no-store')) {
                $responseHeaders['cache-control'] = 'no-store';
            } elseif ($name === 'content-type' && str_starts_with(strtolower($value), 'application/json')) {
                $responseHeaders['content-type'] = 'application/json; charset=utf-8';
            }
        }
        return $length;
    },
]);

if ($route === 'sso') {
    curl_setopt($curl, CURLOPT_POSTFIELDS, file_get_contents('php://input'));
}

$body = curl_exec($curl);
$curlError = curl_errno($curl);
$status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
curl_close($curl);

if ($curlError !== 0 || $body === false) {
    http_response_code(502);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo '{"error":"Terminal SSO service is unavailable."}';
    exit;
}

http_response_code($status ?: 502);
header('Cache-Control: no-store');
foreach ($responseHeaders['set-cookie'] ?? [] as $cookie) {
    header('Set-Cookie: ' . $cookie, false);
}
if (isset($responseHeaders['location'])) {
    header('Location: ' . $responseHeaders['location']);
}
if (isset($responseHeaders['content-type'])) {
    header('Content-Type: ' . $responseHeaders['content-type']);
}
echo $body;
