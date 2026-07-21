require("dotenv").config({ path: ".env" });
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

// Dummy User Model for script
const UserSchema = new mongoose.Schema({
  phone: { type: String, required: true, unique: true },
  email: { type: String, required: false, sparse: true, unique: true },
  password: { type: String, required: false },
  role: { type: String, required: true },
  name: { type: String },
});

const User = mongoose.models.User || mongoose.model("User", UserSchema);

async function seedSuperAdmin() {
  try {
    if (!process.env.MONGODB_URI) {
      console.error("MONGODB_URI is not defined");
      process.exit(1);
    }

    await mongoose.connect(process.env.MONGODB_URI);
    console.log("Connected to MongoDB");

    const email = "superadmin@clancha.com";
    const password = "superadminpassword123";
    const phone = "+10000000000"; // Dummy phone for super admin

    const hashedPassword = await bcrypt.hash(password, 10);

    const existingAdmin = await User.findOne({ email });
    if (existingAdmin) {
      console.log("Super Admin already exists. Updating password...");
      existingAdmin.password = hashedPassword;
      existingAdmin.role = "super_admin";
      await existingAdmin.save();
    } else {
      console.log("Creating new Super Admin...");
      await User.create({
        email,
        password: hashedPassword,
        phone,
        role: "super_admin",
        name: "Super Admin",
      });
    }

    console.log("Super Admin Login Info:");
    console.log("Email:", email);
    console.log("Password:", password);

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error("Error seeding super admin:", error);
    process.exit(1);
  }
}

seedSuperAdmin();
