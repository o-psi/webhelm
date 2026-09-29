<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('vessel_connections', function (Blueprint $table) {
            $table->unsignedInteger('retention_priority')->default(0);
        });
        Schema::table('vessel_pairings', function (Blueprint $table) {
            $table->uuid('vessel_id')->nullable()->index();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('vessel_connections', function (Blueprint $table) {
            $table->dropColumn('retention_priority');
        });
        Schema::table('vessel_pairings', function (Blueprint $table) {
            $table->dropIndex(['vessel_id']);
            $table->dropColumn('vessel_id');
        });
    }
};
