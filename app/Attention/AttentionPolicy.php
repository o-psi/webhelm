<?php

namespace App\Attention;

final class AttentionPolicy
{
    public const DEFAULT_POLICY = 'three_days';
    public const POLICIES = ['three_days', 'seven_days', 'off'];
    public const MAX_BODY_BYTES = 4096;
    public const MAX_RECEIPTS = 10000;

    /** This storage slice has no owner-fact adapter and never performs settlement. */
    public static function eligibility(string $policy): array
    {
        return ['effect' => $policy === 'off' ? 'disabled' : 'unavailable',
            'reason' => $policy === 'off' ? 'policy_off' : 'authoritative_work_and_obligation_facts_unavailable',
            'automatic_settlement' => false];
    }
}
