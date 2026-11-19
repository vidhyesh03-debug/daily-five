// Public settings for the app. None of these are secrets: the database only lets a signed-in,
// invited member see their own data, and the public key can't read any table directly.
window.DAILY_FIVE = {
  supabaseUrl: "https://njqkriltfipnvrzvqqze.supabase.co",
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5qcWtyaWx0ZmlwbnZyenZxcXplIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ4NTQ1OTIsImV4cCI6MjExMDQzMDU5Mn0._Zyp4gHwLvql9-oaIC6Of19vrYPl7wJMdUVIErQ_aAw",
  appUrl: "https://vidhyesh03-debug.github.io/daily-five/",
  apkUrl: "https://github.com/vidhyesh03-debug/daily-five/releases/latest/download/daily-five.apk",
  // Public half of the alert-signing key (the private half is in Supabase Vault).
  vapidPublicKey: "BGmRd1HHO2-Zce-Lf5VEUclhhZa-zGOredTFNoIMd4lON8CtvZkl6o9f6wax59J2Jbk-h9IjkzKSkM4FtxDk8Lw",
};
