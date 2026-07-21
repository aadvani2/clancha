import connectDB from "./lib/db/connect";
import { Channel, User, UserChannelPreferences } from "./lib/db/models";
import { normalizePhoneForMatch } from "./lib/utils/routing";

async function diagnose() {
  await connectDB();
  
  const targetPhones = ["+4474746626433", "+447988518553"];
  console.log("Analyzing users for phones:", targetPhones);
  
  const allUsers = await User.find({ phone: { $in: targetPhones } }).lean();
  console.log("Found users:", allUsers.map(u => ({ id: u._id, phone: u.phone, name: u.name })));
  
  if (allUsers.length === 0) {
    console.log("No users found.");
    process.exit(0);
  }
  
  const userIds = allUsers.map(u => u._id);
  const channels = await Channel.find({ users: { $in: userIds } }).populate("users").lean();
  
  console.log("Found channels:", channels.map(c => ({
    id: c._id,
    users: c.users,
    clanchaNumber: c.clanchaNumber,
    // recvStart: `"${c.receivingHoursStart}"`,
    // recvEnd: `"${c.receivingHoursEnd}"`,
    bypass: c.emergencyBypassEnabled
  })));
  
  for (const channel of channels) {
    const prefs = await UserChannelPreferences.find({ channelId: channel._id }).lean();
    console.log(`Prefs for channel ${channel._id}:`, prefs.map(p => ({
      userId: p.userId,
      // timezone: p.timezone,
      // recvStart: `"${p.receivingHoursStart}"`,
      // recvEnd: `"${p.receivingHoursEnd}"`
    })));
  }
  
  process.exit(0);
}

diagnose();
