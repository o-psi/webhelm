<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="csrf-token" content="{{ csrf_token() }}"><title>Owned browser qualification</title>
@vite(['resources/css/app.css', 'resources/js/browser-qualification.js'])
</head><body class="p-6"><main class="mx-auto max-w-3xl space-y-4" id="browser-qualification"
data-request-url="{{ route('qualification.browser.request', $job) }}" data-response-url="{{ route('qualification.browser.response', $job) }}">
<h1>Owned browser qualification</h1><p>This registered fixture expires at {{ gmdate('H:i:s', $expires) }} UTC. It accepts only responses to issued requests. It does not run host commands.</p>
<button type="button" id="qualification-refresh">Read issued request</button>
<pre aria-label="Issued qualification request" id="qualification-request">No observation yet.</pre>
<form id="qualification-form"><label for="qualification-response">Coordination response</label>
<textarea id="qualification-response" rows="12" class="block w-full border p-2" maxlength="65536" autocomplete="off" spellcheck="false"></textarea>
<button type="submit" id="qualification-submit">Submit this response once</button></form>
<p role="status" id="qualification-status">Read the current request first. Keep the measured viewers open in their own tabs.</p>
</main></body></html>
