# Storage module

The storage module provides file upload, download, and delete using **Cloudflare R2** via the Worker bucket binding. No environment variables are required for storage (see [Env](./env.md) for project env overview). No S3 SDK or third-party storage library is used—only the [Cloudflare R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/). It powers avatar uploads (Settings → Profile) and private user files (Settings → Files).

## Enabling storage (3 steps)

1. **Create the R2 bucket** (once per environment):

   ```bash
   pnpm wrangler r2 bucket create <BUCKET_NAME>
   ```

   Use the same name as `bucket_name` in `wrangler.jsonc` (for example,
   `your-project-storage`).

2. **Configure the bucket in `wrangler.jsonc`**:

   ```jsonc
   "r2_buckets": [
     {
       "bucket_name": "your-project-storage",
       "binding": "BUCKET"
     }
   ]
   ```

   The Worker receives the bucket as `env.BUCKET`. No extra env vars are required for upload/serve.

3. **Enable storage in website config** (`src/config/website.ts`):

   ```ts
   storage: {
     enable: true,
     provider: 'r2',
     maxFileSize: DEFAULT_MAX_FILE_SIZE,       // 10MB
     allowedTypes: DEFAULT_ALLOWED_TYPES,      // [] = all types allowed
     userFilesFolder: DEFAULT_USER_FILES_FOLDER, // 'userfiles'
   },
   ```

   Returned file URLs use the same-origin proxy `/api/storage/file?key=...`.

## Directory structure

```
src/storage/
├── index.ts           # getStorageProvider, uploadFile, deleteFile, downloadFile, getFileInfo, getFile, listUserFiles
├── constants.ts       # DEFAULT_MAX_FILE_SIZE, DEFAULT_ALLOWED_TYPES, DEFAULT_USER_FILES_FOLDER, DEFAULT_AVATARS_FOLDER
├── utils.ts           # PUBLIC_FOLDERS, sanitizeFolder, isPublicFolder
├── types.ts           # StorageProvider, R2BucketInterface, UploadFileResult, errors
└── provider/
    └── r2.ts          # R2Provider (validation, upload, delete, download, list, …)
```

## Configuration

- **websiteConfig.storage** (`src/config/website.ts`)
  - `enable`: Hides the avatar upload card when false. The file server functions and `/api/storage/file` route do **not** check this flag; remove or guard them if you need storage fully off.
  - `provider`: `'r2'`.
  - `maxFileSize`: Max file size in bytes. Default `DEFAULT_MAX_FILE_SIZE` (10MB).
  - `allowedTypes`: Allowed file **extensions**, with or without a leading dot (e.g. `['.jpg', '.png', 'webp']`). Only the extension is compared, so MIME entries such as `'image/webp'` never match. Empty list (default) allows every type.
  - `userFilesFolder`: Parent folder for private per-user files. Default `'userfiles'`.

- **wrangler.jsonc**
  - `r2_buckets`: Bind the R2 bucket with `binding: "BUCKET"` (and `bucket_name`). `R2Provider` reads `env.BUCKET` and throws `ConfigurationError` when it is missing.

## Keys, folders, and visibility

- **Public folders** (`PUBLIC_FOLDERS` in `utils.ts`, currently `['avatars']`): shared resources with no user scoping and no DB record. Key: `avatars/<uuid>-<filename>`.
- **Private files**: scoped by user and recorded in the `user_files` table. Key: `<userFilesFolder>/<userId>/<uuid>-<filename>`, or `<folder>/<userId>/<uuid>-<filename>` when a non-public folder is passed.
- **Sanitization**:
  - `sanitizeFolder` splits on `/`, drops empty, `.`, and `..` segments, and replaces characters outside `[a-zA-Z0-9._-]` with `-`. It applies to both `userFilesFolder` and per-upload folders.
  - Filenames are sanitized to `[a-zA-Z0-9._-]` (others become `_`) and truncated to 255 characters.

To add another public folder (e.g. product images), add its prefix to `PUBLIC_FOLDERS`.

## Upload validation

`R2Provider.uploadFile` rejects an upload when:

- the size exceeds `maxFileSize` (`FILE_TOO_LARGE`);
- `allowedTypes` is non-empty and the extension is not listed (`INVALID_FILE_TYPE`);
- the declared content type is a known MIME type whose extensions don't match the filename (`CONTENT_TYPE_MISMATCH`), e.g. `text/plain` with `.jpg`;
- the content type is `text/html`, `application/javascript`, `text/javascript`, `application/x-httpd-php`, or `application/xhtml+xml` (`DANGEROUS_CONTENT_TYPE`).

## Core API (server, `@/storage`)

- **uploadFile(file, filename, contentType, options?)**
  - `options`: `{ folder?, userId?, requestOrigin? }`.
  - Returns `UploadFileResult { url, key, metadata? }`. `metadata` (id, filename, originalName, contentType, size, r2Key, uploadedAt) is present only when `userId` is passed. `url` is `${requestOrigin}/api/storage/file?key=...`, or the bare key when `requestOrigin` is omitted.
- **deleteFile(key)** — deletes the object from R2.
- **getFile(key)**, **downloadFile(key)**, **getFileInfo(key)** — read an object and its metadata.
- **listUserFiles(userId, { limit?, cursor? })** — lists R2 objects for a user. Not used by the UI, which lists from D1 instead.
- **getStorageProvider()** — lazily creates the configured provider.

## Server functions (`src/api/user-files.ts`)

All use `authApiMiddleware`.

- **uploadUserFile** — accepts `FormData` (`file`, optional `folder`, `isPublic`, `description`).
  - Public folder: uploads without user scoping and writes no DB record.
  - Otherwise: uploads under the user's folder and inserts a `userFiles` row.
  - Storage errors are rethrown as `Error(message)`; other failures become a generic upload error.
  - Uses `Buffer.from`, which relies on the `nodejs_compat` compatibility flag in `wrangler.jsonc`.
- **listUserFiles** — `{ pageIndex, pageSize ≤ 100 }`; pages through the user's `userFiles` rows (newest first) and returns `{ items, total }`.
- **deleteUserFile** — `{ id }`; looks up the user's `userFiles` row, deletes the R2 object, then deletes the row. Avatars have no row, so they cannot be deleted this way.

## Client hooks (`src/hooks/use-user-files.ts`)

- **useUploadUserAvatar()** — uploads with `folder: 'avatars'`; returns `{ url, key }`.
- **useUploadUserFile()** — uploads a private file (no folder, so `userFilesFolder` is used) with optional `isPublic` and `description`.
- **useUserFiles(pageIndex, pageSize)** / **useDeleteUserFile()** — list and delete via the server functions above; mutations invalidate the files query.

## API route: `GET /api/storage/file?key=...`

`src/routes/api/storage/file.ts` streams an object from R2:

| Condition | Response |
|-----------|----------|
| Missing key or key contains `..` | `400` |
| No `userFiles` record and key is not in a public folder | `404` |
| Record with `isPublic` not true, and the requester is not the owner | `403` |
| Object not found in R2 | `404` |
| Bucket binding missing | `503` |

Records with `isPublic = true` and public-folder keys are served without a session.

Response headers:

- `Cache-Control: public, max-age=31536000, immutable` for public files, `private, no-store` otherwise.
- `X-Content-Type-Options: nosniff` always.
- `Content-Disposition: attachment` for any type outside the inline allow-list (common images, SVG, PDF), to prevent stored XSS.

## Consumers

- **Settings → Profile** (`UpdateAvatarCard`): When `websiteConfig.storage.enable` is true, the user can upload an avatar; the client uses `useUploadUserAvatar()` and then updates `user.image` with the returned URL. Replaced avatars are not deleted from R2.
- **Settings → Files** (`src/components/settings/files/`): list, upload, and delete via the server functions above.

## Database

Private file metadata lives in the `user_files` table (`src/db/app.schema.ts`): `id`, `userId` (cascade delete), `filename`, `originalName`, `contentType`, `size`, `r2Key`, `isPublic`, `description`, `createdAt`, `updatedAt`. Avatar URLs are stored in `user.image` (Better Auth) and have no `user_files` row. See [DB](./db.md).

## Notes

- The R2 bucket is provided by the Worker binding only; no S3-style credentials or endpoint are used.
- Deleting a user cascades their `user_files` rows but does not delete the R2 objects.
