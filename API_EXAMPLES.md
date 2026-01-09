# API Usage Examples

## How Shared Types Work

### 1. Define types once in `packages/shared/src/index.ts`:

```typescript
export type CreatePostRequest = {
  content: string;
  tags: string[];
  latitude: number;
  longitude: number;
};
```

### 2. Backend imports and uses them:

```typescript
// apps/backend/src/routes/posts.ts
import type { CreatePostRequest, CreatePostResponse } from '@loba/shared';

fastify.post<{ Body: CreatePostRequest }>(
  '/posts',
  async (request, reply) => {
    // request.body is typed as CreatePostRequest!
    const post = await postService.createPost(request.body);
  }
);
```

### 3. Frontend imports and uses them:

```typescript
// apps/mobile/app/(tabs)/index.tsx
import type { CreatePostRequest, CreatePostResponse } from '@loba/shared';

const handleCreatePost = async () => {
  const requestBody: CreatePostRequest = {
    content: postText,
    tags: tags,
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
  };
  
  const response = await fetch('http://localhost:3000/api/posts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });
  
  const data: CreatePostResponse = await response.json();
  // data.post is fully typed!
};
```

## API Endpoints

### Create Post
```bash
POST http://localhost:3000/api/posts

Request Body:
{
  "content": "Great coffee shop!",
  "tags": ["coffee", "food"],
  "latitude": 37.7749,
  "longitude": -122.4194,
  "photo_url": "https://..." // optional
}

Response:
{
  "success": true,
  "post": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "content": "Great coffee shop!",
    "tags": ["coffee", "food"],
    "latitude": 37.7749,
    "longitude": -122.4194,
    "tile_id": "1398838:-451746",
    "created_at": "2024-01-01T12:00:00Z",
    ...
  }
}
```

### Get Posts by Location
```bash
POST http://localhost:3000/api/posts/by-tiles

Request Body:
{
  "tile_ids": ["1398838:-451746", "1398839:-451746"],
  "limit": 20 // optional
}

Response:
{
  "success": true,
  "posts": [...]
}
```

### Get Single Post
```bash
GET http://localhost:3000/api/posts/123e4567-e89b-12d3-a456-426614174000

Response:
{
  "success": true,
  "post": {...}
}
```

## Type Safety Benefits

✅ Change a type → Both frontend and backend show TypeScript errors
✅ Autocomplete in VS Code for all API requests/responses  
✅ Can't accidentally send wrong data shape
✅ Refactoring is safe (rename fields, TypeScript tracks everywhere)
