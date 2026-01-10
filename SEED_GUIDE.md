# Database Seed Guide

## 🌱 Seeding Test Data

Use these endpoints to populate your database with test posts for development and testing.

---

## 📍 Seed Posts Around Your Location

### **Endpoint:** `POST /api/seed`

Seeds the database with posts clustered around a center point.

**Request:**
```bash
curl -X POST http://localhost:3000/api/seed \
  -H "Content-Type: application/json" \
  -d '{
    "centerLat": 37.7749,
    "centerLng": -122.4194,
    "count": 200
  }'
```

**Parameters:**
- `centerLat` (optional): Center latitude (default: 37.7749 - San Francisco)
- `centerLng` (optional): Center longitude (default: -122.4194)
- `count` (optional): Number of posts to create (default: 200)

**Response:**
```json
{
  "success": true,
  "message": "Seeded 200 posts",
  "center": {
    "latitude": 37.7749,
    "longitude": -122.4194
  },
  "count": 200
}
```

---

## 📊 Post Distribution Pattern

The seed creates posts in realistic clusters:

```
Dense Cluster (40% of posts)
    🔴🔴🔴🔴
    🔴🔴🔴🔴    Center point
    🔴🔴🔴🔴    High activity area
    
Medium Clusters (50% of posts)
    🟠🟠        Nearby areas
      🟠🟠      Residential/commercial
    🟡🟡        Moderate activity
    
Sparse Areas (10% of posts)
🟢    🟢       Outskirts
         🟢    Low activity
    🟢
```

---

## 🏷️ Generated Content

### Tags (Random Selection):
- `#food`, `#restaurant`
- `#coffee`, `#cafe`
- `#parking`, `#cars`
- `#event`, `#music`
- `#park`, `#nature`
- `#shopping`, `#retail`
- `#emergency`, `#safety`
- `#transit`, `#bus`
- `#art`, `#gallery`
- `#gym`, `#fitness`

### Content (Random Selection):
- "Great spot!"
- "Highly recommend this place"
- "Amazing experience here"
- "Just discovered this gem"
- "Perfect location"
- ... and more

---

## 📍 Seed Around Different Locations

### New York City:
```bash
curl -X POST http://localhost:3000/api/seed \
  -H "Content-Type: application/json" \
  -d '{
    "centerLat": 40.7128,
    "centerLng": -74.0060,
    "count": 300
  }'
```

### Los Angeles:
```bash
curl -X POST http://localhost:3000/api/seed \
  -H "Content-Type: application/json" \
  -d '{
    "centerLat": 34.0522,
    "centerLng": -118.2437,
    "count": 250
  }'
```

### London:
```bash
curl -X POST http://localhost:3000/api/seed \
  -H "Content-Type: application/json" \
  -d '{
    "centerLat": 51.5074,
    "centerLng": -0.1278,
    "count": 200
  }'
```

### Tokyo:
```bash
curl -X POST http://localhost:3000/api/seed \
  -H "Content-Type: application/json" \
  -d '{
    "centerLat": 35.6762,
    "centerLng": 139.6503,
    "count": 400
  }'
```

### Your Current Location:
Use your actual GPS coordinates from the mobile app!

---

## 📊 View Statistics

### **Endpoint:** `GET /api/seed/stats`

See how posts are distributed across tiles.

**Request:**
```bash
curl http://localhost:3000/api/seed/stats
```

**Response:**
```json
{
  "success": true,
  "totalPosts": 200,
  "topTiles": [
    { "tile_id": "1401700:-3590559", "count": 15 },
    { "tile_id": "1401701:-3590559", "count": 12 },
    { "tile_id": "1401702:-3590560", "count": 10 },
    ...
  ]
}
```

Shows:
- Total posts in database
- Top 20 tiles by post count
- Helps verify seed distribution

---

## 🗑️ Clear Database

### **Endpoint:** `DELETE /api/seed`

⚠️ **WARNING:** Deletes ALL posts from the database!

**Request:**
```bash
curl -X DELETE http://localhost:3000/api/seed
```

**Response:**
```json
{
  "success": true,
  "message": "Deleted all posts",
  "deletedCount": 200
}
```

**Use cases:**
- Reset database between tests
- Clear old seed data before re-seeding
- Start fresh

---

## 🎯 Recommended Testing Workflow

### 1. Clear Existing Data
```bash
curl -X DELETE http://localhost:3000/api/seed
```

### 2. Seed Your Location
Open mobile app, get your GPS coordinates, then:
```bash
curl -X POST http://localhost:3000/api/seed \
  -H "Content-Type: application/json" \
  -d '{
    "centerLat": YOUR_LATITUDE,
    "centerLng": YOUR_LONGITUDE,
    "count": 500
  }'
```

### 3. View Stats
```bash
curl http://localhost:3000/api/seed/stats
```

### 4. Test Mobile App
1. Restart mobile app (or pull to refresh)
2. See posts appear on map
3. Zoom in/out to watch grouping
4. Tap markers to see posts

---

## 📈 Recommended Seed Counts

| Use Case | Count | Description |
|----------|-------|-------------|
| Quick test | 50 | Fast, see basic grouping |
| Normal test | 200 | Good variety, see clusters |
| Stress test | 500 | Test performance |
| Full test | 1000 | See all grouping levels |
| Extreme | 2000+ | Performance testing |

---

## 🎨 What You'll See

### At Zoom 20 (Street Level):
```
🟢 1    🟢 1    🔵 3    🟢 1
Many individual tiles with 1-3 posts
High detail, atomic units
```

### At Zoom 18 (Block Level):
```
🔵 8    🟡 12   🟠 15   🔵 6
Tiles grouped into 2×2 (×2)
Medium detail, clear clusters
```

### At Zoom 16 (District):
```
🟡 25   🟠 40   🔴 65   🟡 28
Tiles grouped into 4×4 (×4)
Lower detail, major hotspots visible
```

### At Zoom 14 (City):
```
🟠 120  🔴 280
Tiles grouped into 8×8 (×8)
Very low detail, city-wide overview
```

---

## 💡 Pro Tips

1. **Seed before first mobile app test** to have data immediately
2. **Use higher counts (500+)** to really see the grouping feature shine
3. **Seed around YOUR location** so you can physically explore the map
4. **Check stats** to verify distribution is working
5. **Clear and re-seed** if you want different patterns
6. **Seed multiple locations** to test panning behavior

---

## 🐛 Troubleshooting

### Seed Request Times Out
- Reduce count (try 100 instead of 500)
- Check backend logs for errors
- Verify database connection

### Posts Not Appearing in App
- Check stats endpoint - are posts created?
- Verify posts are near your app's location
- Try restarting mobile app
- Check fetch area in mobile app (11×11 grid)

### All Posts in Same Tile
- Check seed distribution logic
- Verify centerLat/centerLng are correct
- Try different center point

---

## 📝 Example: Complete Test Flow

```bash
# 1. Start backend
cd loba
npm run backend

# 2. Clear database
curl -X DELETE http://localhost:3000/api/seed

# 3. Seed 500 posts in San Francisco
curl -X POST http://localhost:3000/api/seed \
  -H "Content-Type: application/json" \
  -d '{"centerLat": 37.7749, "centerLng": -122.4194, "count": 500}'

# 4. Check stats
curl http://localhost:3000/api/seed/stats

# 5. Open mobile app and explore!
```

---

Happy testing! 🎉
