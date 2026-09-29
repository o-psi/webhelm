<?php

namespace App\Models;

use App\WebPlan;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable(['id', 'principal_id', 'name'])]
class Tenant extends Model
{
    use HasUuids;

    protected function casts(): array
    {
        return [
            'plan' => WebPlan::class,
            'paid_through_at' => 'datetime',
            'stripe_ended_at' => 'datetime',
        ];
    }

    public function effectivePlan(): WebPlan
    {
        return $this->plan !== null && $this->plan !== WebPlan::Free && $this->paid_through_at?->isFuture()
            ? $this->plan
            : WebPlan::Free;
    }

    public function uniqueIds(): array
    {
        return ['id', 'principal_id'];
    }

    public function users(): HasMany
    {
        return $this->hasMany(User::class);
    }
}
