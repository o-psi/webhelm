<?php

namespace App\Services;

use GuzzleHttp\RequestOptions;
use Laravel\Socialite\Two\InvalidStateException;
use Laravel\Socialite\Two\User;
use SocialiteProviders\Microsoft\Provider;
use stdClass;

/**
 * Preserve the audited signature/key-rollover implementation while tightening
 * its audience comparison and binding each identity to the login attempt.
 */
class MicrosoftProvider extends Provider
{
    private bool $claimsValidated = false;

    protected function getCodeFields($state = null): array
    {
        $fields = parent::getCodeFields($state);
        $fields['nonce'] = bin2hex(random_bytes(32));
        $this->request->session()->put('helm_microsoft_nonce', $fields['nonce']);

        return $fields;
    }

    public function getClaims(): ?stdClass
    {
        $claims = parent::getClaims();
        if ($this->claimsValidated) {
            return $claims;
        }

        $nonce = $this->request->session()->pull('helm_microsoft_nonce');
        $audience = $claims?->aud;
        $tenant = $claims?->tid;
        $subject = $claims?->sub;
        if (! $claims || ! is_string($audience) || ! hash_equals($this->clientId, $audience)
            || (isset($claims->azp) && $claims->azp !== $this->clientId)
            || ! is_string($tenant) || ! preg_match('/\A[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\z/iD', $tenant)
            || ($claims->iss ?? null) !== 'https://login.microsoftonline.com/'.$tenant.'/v2.0'
            || ! is_string($subject) || $subject === '' || strlen($subject) > 154
            || ! is_int($claims->iat ?? null) || $claims->iat > time()
            || ! is_int($claims->exp ?? null) || $claims->exp <= time()
            || ! is_string($nonce) || ! is_string($claims->nonce ?? null)
            || ! hash_equals($nonce, $claims->nonce)) {
            throw new InvalidStateException('Invalid Microsoft sign-in identity.');
        }

        $this->claimsValidated = true;

        return $claims;
    }

    protected function getUserByToken($token): array
    {
        // Validate before retrieving profile data. An absent ID token fails closed.
        $claims = $this->getClaims();
        if (! is_string($token) || $token === '') {
            throw new InvalidStateException('Missing Microsoft access token.');
        }

        $response = $this->getHttpClient()->get('https://graph.microsoft.com/v1.0/me', [
            RequestOptions::HEADERS => ['Accept' => 'application/json', 'Authorization' => 'Bearer '.$token],
            RequestOptions::QUERY => ['$select' => 'id,displayName'],
        ]);
        if ($response->getStatusCode() !== 200) {
            throw new InvalidStateException('Microsoft profile request did not succeed.');
        }
        $body = (string) $response->getBody();
        if (strlen($body) > 1048576) {
            throw new InvalidStateException('Microsoft profile exceeds the response limit.');
        }
        $profile = json_decode($body, true, 32, JSON_THROW_ON_ERROR);
        if (! is_array($profile) || ! is_string($profile['id'] ?? null) || $profile['id'] === '') {
            throw new InvalidStateException('Invalid Microsoft profile.');
        }

        // The signed, app-scoped subject is opaque. Tenant qualification prevents
        // cross-issuer collisions without relying on Graph's ID format or email.
        return [
            'id' => strtolower($claims->tid).':'.$claims->sub,
            'name' => is_string($profile['displayName'] ?? null) ? $profile['displayName'] : null,
        ];
    }

    protected function mapUserToObject(array $user): User
    {
        return (new User)->map($user);
    }
}
