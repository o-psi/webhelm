<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('attention_policies', function (Blueprint $table): void {
            $table->foreignUuid('tenant_id')->primary()->constrained('tenants')->restrictOnDelete();
            $table->string('stale_policy', 16)->default('three_days');
            $table->unsignedBigInteger('revision')->default(0);
        });
        Schema::create('attention_policy_receipts', function (Blueprint $table): void {
            $table->id();
            $table->foreignUuid('tenant_id')->constrained('tenants')->restrictOnDelete();
            $table->uuid('operation_id');
            $table->string('request_hash', 64);
            $table->unsignedSmallInteger('status');
            $table->text('response');
            $table->timestamp('recorded_at');
            $table->unique(['tenant_id', 'operation_id']);
        });
    }

    public function down(): void
    {
        throw new RuntimeException('Attention receipt rollback requires a data-preserving review; never erase no-replay evidence.');
    }
};
