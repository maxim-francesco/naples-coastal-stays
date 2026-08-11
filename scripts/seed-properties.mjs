import { createClient } from "@supabase/supabase-js"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Load environment variables from .env.local if not already defined
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

const url = process.env.SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url) {
  console.error("Error: SUPABASE_URL is not set.")
  process.exit(1)
}
if (!serviceRoleKey) {
  console.error("Error: SUPABASE_SERVICE_ROLE_KEY is not set.")
  process.exit(1)
}

const supabase = createClient(url, serviceRoleKey)

const propertiesToUpdate = [
  {
    id: "31c25214-42c5-4211-8b5d-28643ebbbe35",
    name: "Cathedral Heights",
    area: "Naples, Florida — Cathedral Heights",
    max_guests: 8,
    bedrooms: 4,
    bathrooms: 2,
    short_description: "A five-minute drive to Clam Pass Beach, close to shopping and dining. Small dogs welcome.",
    long_description: [
      "Cathedral Heights is an entire four-bedroom home tucked into a quiet residential neighbourhood in Naples, kept clean and well-stocked for easy family stays.",
      "The screened-in private pool is the heart of the home, with loungers and a covered outdoor living area for relaxing between beach days.",
      "You're about a fifteen-minute walk from The Baker Museum and a short drive from Clam Pass Beach, with shopping and dining close by."
    ],
    amenities: [
      "Pool",
      "Free parking",
      "Wifi",
      "Air conditioning",
      "Kitchen",
      "Indoor fireplace",
      "Ceiling fan",
      "Washer & dryer",
      "TV with standard cable",
      "Coffee maker",
      "Private entrance",
      "Crib",
      "High chair",
      "Smoke alarm"
    ]
  },
  {
    id: "ea7ba62c-c41f-4671-9846-a51052d1943f",
    name: "Turtle Lake",
    area: "Naples, Florida — Turtle Lakes community",
    max_guests: 4,
    bedrooms: 2,
    bathrooms: 2,
    short_description: "A recently renovated two-bedroom condo in Turtle Lakes, walking distance to shopping and dining and minutes from Clam Pass Beach.",
    long_description: [
      "Turtle Lake is a recently renovated two-bedroom, two-bath condo in the Turtle Lakes community, finished with new tile, laminate flooring and high-end furnishings.",
      "The master bedroom has a king bed and private bathroom, the guest room a queen, and the open living room features an electric fireplace and a large TV.",
      "The community adds a golf course, tennis court, shared pool, gym, sauna and clubhouse, with a screened lanai off the living room for the Florida climate."
    ],
    amenities: [
      "Beach access",
      "Wifi",
      "Air conditioning",
      "Kitchen",
      "Dedicated workspace",
      "Shared pool",
      "Indoor fireplace",
      "Washer & dryer",
      "HDTV with Netflix",
      "Elevator",
      "Free parking",
      "Bathtub",
      "Coffee maker",
      "Dishwasher",
      "Smoke alarm"
    ]
  }
]

async function runSeed() {
  console.log("=== STARTING SEED UPDATE ===")
  for (const property of propertiesToUpdate) {
    const { id, ...updateData } = property
    console.log(`Updating property with ID: ${id}...`)
    
    const { data, error } = await supabase
      .from("properties")
      .update(updateData)
      .eq("id", id)
      .select()

    if (error) {
      console.error(`Error updating property ${id}:`, error)
      process.exit(1)
    }

    if (!data || data.length === 0) {
      console.error(`Error: No rows updated for property ID ${id}. Does it exist?`)
      process.exit(1)
    }

    console.log(`SUCCESS: Property ${id} updated. Returned row:`)
    console.log(JSON.stringify(data[0], null, 2))
  }

  console.log("\n=== RUNNING READ-ONLY VERIFICATION SELECT ===")
  const { data: verifiedData, error: verifyError } = await supabase
    .from("properties")
    .select("id, name, area, short_description, long_description, max_guests, bedrooms, bathrooms, amenities")
    .in("id", propertiesToUpdate.map(p => p.id))

  if (verifyError) {
    console.error("Verification SELECT failed:", verifyError)
    process.exit(1)
  }

  console.log("VERIFICATION SELECT OUTPUT:")
  console.log(JSON.stringify(verifiedData, null, 2))
  console.log("=== SEEDING COMPLETED SUCCESSFULLY ===")
}

runSeed().catch(err => {
  console.error("Unexpected error in runSeed:", err)
  process.exit(1)
})
