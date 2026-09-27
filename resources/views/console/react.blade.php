<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="csrf-token" content="{{ csrf_token() }}">
    <meta name="robots" content="noindex, nofollow">
    <title>Helm Console</title>
    @viteReactRefresh
    @vite('resources/react/main.tsx')
</head>
<body>
    <div id="helm-react" data-bootstrap="{{ json_encode($bootstrap) }}"></div>
    <noscript>Helm requires JavaScript to connect to your Vessels.</noscript>
</body>
</html>
