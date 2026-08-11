import { createClient } from "@supabase/supabase-js"
import { v2 as cloudinary } from "cloudinary"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 1. Load environment variables from .env.local via the relative path
const envPath = path.resolve(__dirname, "../.env.local")
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf-8")
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const firstEquals = trimmed.indexOf("=")
    if (firstEquals === -1) continue
    const key = trimmed.slice(0, firstEquals).trim()
    const value = trimmed.slice(firstEquals + 1).replace(/^['"]|['"]$/g, "").trim()
    if (key && !process.env[key]) {
      process.env[key] = value
    }
  }
}

const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const cloudName = process.env.CLOUDINARY_CLOUD_NAME
const apiKey = process.env.CLOUDINARY_API_KEY
const apiSecret = process.env.CLOUDINARY_API_SECRET

// Validate Environment Variables
if (!supabaseUrl) {
  console.error("Error: SUPABASE_URL is not set.")
  process.exit(1)
}
if (!supabaseServiceRoleKey) {
  console.error("Error: SUPABASE_SERVICE_ROLE_KEY is not set.")
  process.exit(1)
}
if (!cloudName) {
  console.error("Error: CLOUDINARY_CLOUD_NAME is not set.")
  process.exit(1)
}
if (!apiKey) {
  console.error("Error: CLOUDINARY_API_KEY is not set.")
  process.exit(1)
}
if (!apiSecret) {
  console.error("Error: CLOUDINARY_API_SECRET is not set.")
  process.exit(1)
}

// 2. Configure the Cloudinary SDK
cloudinary.config({
  cloud_name: cloudName,
  api_key: apiKey,
  api_secret: apiSecret,
})

// 3. Initialize Supabase Admin Client
const supabase = createClient(supabaseUrl, supabaseServiceRoleKey)

// Target photo configurations
const cathedralHeightsId = "31c25214-42c5-4211-8b5d-28643ebbbe35"
const cathedralConfig = [
  { token: "dyr097ikk6qr3bcaw6rj", sort_order: 1, is_cover: true },  // exterior A-frame
  { token: "zdxwg5bhj3cl00luoeeq", sort_order: 2, is_cover: false }, // pool
  { token: "rvqyclsavx9dhyteubzs", sort_order: 3, is_cover: false }, // bedroom w/ TV
  { token: "ebh0kx5ohicokivtd2kd", sort_order: 4, is_cover: false }, // living w/ fireplace
  { token: "adhuicuwdv5ipa2t477j", sort_order: 5, is_cover: false }, // second bedroom
]

const turtleLakeId = "ea7ba62c-c41f-4671-9846-a51052d1943f"
const turtleDeleteToken = "ku0idi56tpzxfcu6grnm" // phone screenshot
const turtleConfig = [
  { token: "vmuvcaoueaiwnfo86gnr", sort_order: 1, is_cover: true },  // warm King bedroom (new cover)
  { token: "gs7cgi1xlioukkcnlohn", sort_order: 2, is_cover: false }, // bright living
  { token: "usfhoyyjas6ircyno2ql", sort_order: 3, is_cover: false }, // dining/kitchen
  { token: "s4evarvd2pbgbwmgj9ma", sort_order: 4, is_cover: false }, // second bedroom
  { token: "bsk2wpgf3ccvdhm6l2yq", sort_order: 5, is_cover: false }, // guest bedroom
  { token: "w5aax3gtdbkkkzxbm2ll", sort_order: 6, is_cover: false }, // living w/ TV (pushed last)
]

async function runReorder() {
  console.log("=== STARTING REORDER AND DELETE PHOTOS SCRIPT ===")

  // --- TURTLE LAKE DELETE BAD PHOTO ---
  console.log(`\nChecking if screenshot photo (${turtleDeleteToken}) exists to delete...`)
  const { data: deleteRows, error: findError } = await supabase
    .from("property_photos")
    .select("id, storage_path, public_url")
    .eq("property_id", turtleLakeId)

  if (findError) {
    console.error("Error searching photos for deletion:", findError)
    process.exit(1)
  }

  const badPhotoRow = deleteRows.find(r => r.public_url.includes(turtleDeleteToken))

  if (badPhotoRow) {
    console.log(`Found photo row in DB for ${turtleDeleteToken}. storage_path: ${badPhotoRow.storage_path}`)
    
    // Delete from Cloudinary
    if (badPhotoRow.storage_path) {
      console.log(`Deleting asset from Cloudinary...`)
      try {
        const destroyResult = await cloudinary.uploader.destroy(badPhotoRow.storage_path)
        console.log(`[Cloudinary Destroy Result]`, destroyResult)
      } catch (cloudinaryErr) {
        console.error(`Failed to delete from Cloudinary (continuing anyway):`, cloudinaryErr)
      }
    }

    // Delete from DB
    console.log(`Deleting row from property_photos DB...`)
    const { error: dbDeleteError } = await supabase
      .from("property_photos")
      .delete()
      .eq("id", badPhotoRow.id)

    if (dbDeleteError) {
      console.error(`Failed to delete row from DB:`, dbDeleteError)
      process.exit(1)
    }
    console.log(`[DB Delete Success] Photo deleted successfully.`)
  } else {
    console.log(`Screenshot photo (${turtleDeleteToken}) already deleted. Skipping delete step.`)
  }

  // --- CATHEDRAL HEIGHTS REORDER ---
  console.log(`\nReordering Cathedral Heights photos...`)
  const { data: cathedralRows, error: cathFetchErr } = await supabase
    .from("property_photos")
    .select("id, public_url")
    .eq("property_id", cathedralHeightsId)

  if (cathFetchErr) {
    console.error("Error fetching Cathedral Heights photos:", cathFetchErr)
    process.exit(1)
  }

  for (const item of cathedralConfig) {
    const row = cathedralRows.find(r => r.public_url.includes(item.token))
    if (!row) {
      console.error(`Error: Could not find Cathedral Heights photo with token ${item.token}`)
      process.exit(1)
    }

    console.log(`Updating ${item.token} -> sort_order: ${item.sort_order}, is_cover: ${item.is_cover}`)
    const { error: updateErr } = await supabase
      .from("property_photos")
      .update({
        sort_order: item.sort_order,
        is_cover: item.is_cover
      })
      .eq("id", row.id)

    if (updateErr) {
      console.error(`Error updating photo ${item.token}:`, updateErr)
      process.exit(1)
    }
  }

  // --- TURTLE LAKE REORDER ---
  console.log(`\nReordering Turtle Lake photos...`)
  const { data: turtleRows, error: turtleFetchErr } = await supabase
    .from("property_photos")
    .select("id, public_url")
    .eq("property_id", turtleLakeId)

  if (turtleFetchErr) {
    console.error("Error fetching Turtle Lake photos:", turtleFetchErr)
    process.exit(1)
  }

  for (const item of turtleConfig) {
    const row = turtleRows.find(r => r.public_url.includes(item.token))
    if (!row) {
      console.error(`Error: Could not find Turtle Lake photo with token ${item.token}`)
      process.exit(1)
    }

    console.log(`Updating ${item.token} -> sort_order: ${item.sort_order}, is_cover: ${item.is_cover}`)
    const { error: updateErr } = await supabase
      .from("property_photos")
      .update({
        sort_order: item.sort_order,
        is_cover: item.is_cover
      })
      .eq("id", row.id)

    if (updateErr) {
      console.error(`Error updating photo ${item.token}:`, updateErr)
      process.exit(1)
    }
  }

  console.log("\n=== REORDER AND DELETE SCRIPT COMPLETED SUCCESSFULLY ===")
}

runReorder().catch(err => {
  console.error("Unexpected error in runReorder:", err)
  process.exit(1)
})
