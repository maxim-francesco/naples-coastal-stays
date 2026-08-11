import { createClient } from "@supabase/supabase-js"
import { v2 as cloudinary } from "cloudinary"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 1. Load environment variables from .env.local if not already defined
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

// 4. Define the image sets
const properties = [
  {
    id: "31c25214-42c5-4211-8b5d-28643ebbbe35",
    name: "Cathedral Heights",
    images: [
      "https://a0.muscache.com/im/pictures/miso/Hosting-45816145/original/0d0f3464-76a9-4966-8af1-6e767d94c254.jpeg?im_w=1600",
      "https://a0.muscache.com/im/pictures/miso/Hosting-45816145/original/def7a79a-61df-4368-a2f1-2c629e0cfc36.jpeg?im_w=1600",
      "https://a0.muscache.com/im/pictures/miso/Hosting-45816145/original/5417752b-8a9c-4bf7-b6f3-712a8cc62a72.jpeg?im_w=1600",
      "https://a0.muscache.com/im/pictures/miso/Hosting-45816145/original/0ef0eec0-5258-47e3-a642-7a4ddc6d2ee4.jpeg?im_w=1600",
      "https://a0.muscache.com/im/pictures/miso/Hosting-45816145/original/98cc42bc-8fbf-4b3f-b9e5-b074ad6fc39b.jpeg?im_w=1600"
    ]
  },
  {
    id: "ea7ba62c-c41f-4671-9846-a51052d1943f",
    name: "Turtle Lake",
    images: [
      "https://a0.muscache.com/im/pictures/hosting/Hosting-552917772776250879/original/56d80276-479f-47df-b68e-c8e06b874bf3.jpeg?im_w=1600",
      "https://a0.muscache.com/im/pictures/hosting/Hosting-552917772776250879/original/d6b0e661-a790-44e3-ae6f-c2a8d4bd2926.jpeg?im_w=1600",
      "https://a0.muscache.com/im/pictures/hosting/Hosting-552917772776250879/original/f5d37172-5155-4c9f-b064-64b59cc7f585.png?im_w=1600",
      "https://a0.muscache.com/im/pictures/hosting/Hosting-552917772776250879/original/065f48ab-01e3-4e00-b8b3-6f5e85887dec.jpeg?im_w=1600",
      "https://a0.muscache.com/im/pictures/hosting/Hosting-552917772776250879/original/1d53a2ec-5d09-453f-9e48-09903385ab20.jpeg?im_w=1600",
      "https://a0.muscache.com/im/pictures/hosting/Hosting-552917772776250879/original/6c0f6665-cdf9-4f55-867b-751cc5d191b4.jpeg?im_w=1600",
      "https://a0.muscache.com/im/pictures/hosting/Hosting-552917772776250879/original/f88ed36c-291a-41c5-88c6-79c7c4a708dc.jpeg?im_w=1600"
    ]
  }
]

// Helper to determine the best working URL by checking responsiveness of each option
async function getWorkingUrl(url) {
  const candidates = [
    url, // Try original (with im_w=1600)
    url.replace("im_w=1600", "im_w=1440"),
    url.replace("im_w=1600", "im_w=1200"),
    url.replace(/\?im_w=\d+/, ""), // Try base url without query params
  ]

  for (const candidate of candidates) {
    try {
      const res = await fetch(candidate, { method: "HEAD" })
      if (res.status === 200) {
        return candidate
      }
    } catch (e) {
      // Ignore network errors and try next
    }
  }

  // Fallback to the original URL if checks fail/network issue
  return url
}

async function runSeed() {
  console.log("=== STARTING SEED PHOTOS SCRIPT ===")
  
  for (const property of properties) {
    console.log(`\nChecking photos for property "${property.name}" (${property.id})...`)
    
    // 5. Idempotency Check
    const { data: existingPhotos, error: fetchError } = await supabase
      .from("property_photos")
      .select("id")
      .eq("property_id", property.id)

    if (fetchError) {
      console.error(`Error querying existing photos for property ${property.id}:`, fetchError)
      process.exit(1)
    }

    if (existingPhotos && existingPhotos.length > 0) {
      console.log(`[SKIP] Property "${property.name}" already has ${existingPhotos.length} photo(s). Skipping.`)
      continue
    }

    console.log(`No existing photos found for "${property.name}". Proceeding to upload ${property.images.length} images...`)

    // 6. Upload & Insert for each image
    for (let index = 0; index < property.images.length; index++) {
      const targetUrl = property.images[index]
      const sortOrder = index + 1
      const isCover = index === 0
      
      console.log(`[${sortOrder}/${property.images.length}] Checking best working URL for: ${targetUrl}`)
      const imageUrl = await getWorkingUrl(targetUrl)
      console.log(`Selected URL: ${imageUrl}`)
      
      let uploadResult
      try {
        uploadResult = await cloudinary.uploader.upload(imageUrl, {
          folder: `naples-coastal-stays/${property.id}`,
        })
      } catch (uploadError) {
        console.error(`Error uploading image to Cloudinary:`, uploadError)
        process.exit(1)
      }

      console.log(`[Cloudinary Success] public_id: ${uploadResult.public_id}, secure_url: ${uploadResult.secure_url}`)

      const photoPayload = {
        property_id: property.id,
        storage_path: uploadResult.public_id,
        public_url: uploadResult.secure_url,
        alt: `${property.name} — placeholder photo`,
        sort_order: sortOrder,
        is_cover: isCover,
      }

      console.log(`Inserting DB row for "${property.name}" (sort_order: ${sortOrder}, is_cover: ${isCover})...`)
      
      const { data: insertedData, error: insertError } = await supabase
        .from("property_photos")
        .insert(photoPayload)
        .select()

      if (insertError) {
        console.error(`Error inserting photo row into DB:`, insertError)
        process.exit(1)
      }

      console.log(`[DB Success] Inserted row id: ${insertedData[0].id}`)
    }
  }

  console.log("\n=== SEED PHOTOS SCRIPT COMPLETED SUCCESSFULLY ===")
}

runSeed().catch(err => {
  console.error("Unexpected error in runSeed:", err)
  process.exit(1)
})
