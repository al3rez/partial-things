<?php

declare(strict_types=1);

$uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';

if ($uri === '/api' || $uri === '/api.php') {
    require dirname(__DIR__) . '/api.php';
    return true;
}

if ($uri === '/' || $uri === '/index.html') {
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: no-store');
    readfile(__DIR__ . '/index.html');
    return true;
}

$path = realpath(__DIR__ . $uri);
if ($path && str_starts_with($path, __DIR__) && is_file($path)) {
    return false;
}

http_response_code(404);
header('Content-Type: text/plain; charset=utf-8');
echo 'Not found';
return true;
