-- Login now authenticates by name instead of email, so name must be unique
CREATE UNIQUE INDEX "User_name_key" ON "User"("name");
