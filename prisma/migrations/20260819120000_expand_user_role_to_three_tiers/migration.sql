-- Rename existing ADMIN role to SYSTEM_ADMIN (top tier), keeping existing rows intact
ALTER TYPE "UserRole" RENAME VALUE 'ADMIN' TO 'SYSTEM_ADMIN';

-- Add new middle tier
ALTER TYPE "UserRole" ADD VALUE 'DELIVERY_ADMIN';
