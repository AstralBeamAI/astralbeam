import { verifiedImage, embeddedImage } from "./image-validation.server"
import { and, eq, isNull, isNotNull, or, sql } from "drizzle-orm"
import { Context, Effect, Layer, Result } from "effect"

import { DatabaseRateLimiter } from "@/db/lib/rate-limiter"
import { Database } from "@/db/database"
import { mapDatabaseErrors } from "@/db/lib/sqlstate"
import { user } from "@/db/schema/authentication"
import { fileObject } from "@/db/schema/files"
import { organization } from "@/db/schema/organizations"
import {
  ImageImportUnavailable,
  ImageUploadRateLimited,
  InvalidImage,
  StorageObjectMissing,
  StorageUnavailable,
} from "./errors"
import { ImageSources } from "./image-source.server"
import { avatarFileId, avatarFileUrl, logoFileUrl } from "./images"
import { StoredFiles } from "./stored-files.server"

type ImageImportInput = (
  | { kind: "avatar"; userId: string; emailHash: string }
  | { kind: "logo"; ownerId: string; generation: string }
) & { attempts: number }

export class ProfileFiles extends Context.Service<
  ProfileFiles,
  {
    readonly uploadAvatar: (options: {
      userId: string
      bytes: Uint8Array
    }) => Effect.Effect<
      string,
      InvalidImage | StorageUnavailable | StorageObjectMissing | ImageUploadRateLimited
    >
    readonly setAvatar: (options: {
      userId: string
      fileId: string
    }) => Effect.Effect<string | null, InvalidImage>
    readonly validateAvatar: (options: {
      userId: string
      image: string
    }) => Effect.Effect<string, InvalidImage>
    readonly validateLogo: (options: {
      organizationId: string
      image: string
    }) => Effect.Effect<string, InvalidImage>
    readonly uploadLogo: (options: {
      source: string
      userId: string
    }) => Effect.Effect<
      string,
      InvalidImage | StorageUnavailable | StorageObjectMissing | ImageUploadRateLimited
    >
    readonly attachLogo: (options: {
      organizationId: string
      fileId: string
    }) => Effect.Effect<string, InvalidImage>
    readonly setLogo: (options: {
      organizationId: string
      fileId: string
      generation?: string
    }) => Effect.Effect<string | null, InvalidImage>
    readonly importImage: (input: ImageImportInput) => Effect.Effect<"done" | "retry" | "storage">
  }
>()("astralbeam/storage/ProfileFiles") {
  // Coordinates image uploads and imports with scoped avatar and logo ownership.
  static readonly layerNoDeps = Layer.effect(
    ProfileFiles,
    Effect.gen(function* () {
      const db = yield* Database
      const files = yield* StoredFiles
      const sources = yield* ImageSources
      const limiter = yield* DatabaseRateLimiter
      const validateAvatar = Effect.fn("ProfileFiles.validateAvatar")(function* ({
        userId,
        image,
      }: {
        userId: string
        image: string
      }) {
        const id = avatarFileId(image)
        if (!id) return yield* new InvalidImage()
        const [file] = yield* db
          .select({ id: fileObject.id })
          .from(fileObject)
          .where(
            and(
              eq(fileObject.id, id),
              eq(fileObject.userId, userId),
              eq(fileObject.status, "stored"),
            ),
          )
          .pipe(mapDatabaseErrors())
        if (!file) return yield* new InvalidImage()
        return id
      })
      const validateLogo = Effect.fn("ProfileFiles.validateLogo")(function* ({
        organizationId,
        image,
      }: {
        organizationId: string
        image: string
      }) {
        const [row] = yield* db
          .select({ id: fileObject.id })
          .from(fileObject)
          .where(
            and(
              eq(fileObject.organizationId, organizationId),
              sql`${image} = '/api/files/organizations/' || ${fileObject.organizationId} || '/logos/' || ${fileObject.id}`,
              eq(fileObject.status, "stored"),
            ),
          )
          .limit(1)
          .pipe(mapDatabaseErrors())
        if (!row) return yield* new InvalidImage()
        return row.id
      })
      const consumeUpload = Effect.fn("ProfileFiles.consumeUpload")(function* (userId: string) {
        yield* limiter
          .consume({ key: `profile-upload:${userId}`, limit: 10, window: "1 hour" })
          .pipe(
            Effect.catch((error) =>
              error.reason._tag === "RateLimitExceeded"
                ? Effect.fail(new ImageUploadRateLimited())
                : Effect.die(error),
            ),
          )
      })
      const uploadAvatar = Effect.fn("ProfileFiles.uploadAvatar")(function* ({
        userId,
        bytes,
      }: {
        userId: string
        bytes: Uint8Array
      }) {
        yield* consumeUpload(userId)
        const image = yield* verifiedImage(bytes)
        const file = yield* files.upload(image)
        yield* db
          .update(fileObject)
          .set({ userId })
          .where(eq(fileObject.id, file.id))
          .pipe(mapDatabaseErrors())
        return avatarFileUrl(file.id)
      })
      const uploadLogo = Effect.fn("ProfileFiles.uploadLogo")(function* ({
        source,
        userId,
      }: {
        source: string
        userId: string
      }) {
        yield* consumeUpload(userId)
        const image = yield* embeddedImage(source)
        return (yield* files.upload(image)).id
      })
      const attachLogo = Effect.fn("ProfileFiles.attachLogo")(function* ({
        organizationId,
        fileId,
      }: {
        organizationId: string
        fileId: string
      }) {
        const [attached] = yield* db
          .update(fileObject)
          .set({ organizationId })
          .where(
            and(
              eq(fileObject.id, fileId),
              isNull(fileObject.userId),
              eq(fileObject.status, "stored"),
              sql`(${fileObject.organizationId} is null or ${fileObject.organizationId} = ${organizationId})`,
            ),
          )
          .returning({ id: fileObject.id })
          .pipe(mapDatabaseErrors())
        if (!attached) return yield* new InvalidImage()
        return logoFileUrl(organizationId, fileId)
      })
      const setLogo = Effect.fn("ProfileFiles.setLogo")(function* ({
        organizationId,
        fileId,
        generation,
      }: {
        organizationId: string
        fileId: string
        generation?: string
      }) {
        return yield* db
          .transaction((tx) =>
            Effect.gen(function* () {
              const [owner] = yield* tx
                .select()
                .from(organization)
                .where(eq(organization.id, organizationId))
                .for("update")
                .pipe(mapDatabaseErrors())
              if (!owner || (generation && owner.logoImportGeneration !== generation)) return null
              const [file] = yield* tx
                .update(fileObject)
                .set({ organizationId })
                .where(
                  and(
                    eq(fileObject.id, fileId),
                    eq(fileObject.status, "stored"),
                    isNull(fileObject.userId),
                    or(
                      isNull(fileObject.organizationId),
                      eq(fileObject.organizationId, organizationId),
                    ),
                  ),
                )
                .returning({ id: fileObject.id })
                .pipe(mapDatabaseErrors())
              if (!file) return yield* new InvalidImage()
              const logo = logoFileUrl(organizationId, fileId)
              yield* tx
                .update(organization)
                .set({
                  logo,
                  logoFileId: fileId,
                  logoImportSourceUrl: null,
                  logoImportGeneration: generation ?? crypto.randomUUID(),
                })
                .where(eq(organization.id, organizationId))
                .pipe(mapDatabaseErrors())
              return logo
            }),
          )
          .pipe(mapDatabaseErrors())
      })
      const setAvatar = Effect.fn("ProfileFiles.setAvatar")(function* ({
        userId,
        fileId,
      }: {
        userId: string
        fileId: string
      }) {
        return yield* db
          .transaction((tx) =>
            Effect.gen(function* () {
              const [owner] = yield* tx
                .select({ id: user.id })
                .from(user)
                .where(eq(user.id, userId))
                .for("update")
                .pipe(mapDatabaseErrors())
              if (!owner) return null
              const [file] = yield* tx
                .update(fileObject)
                .set({ userId })
                .where(
                  and(
                    eq(fileObject.id, fileId),
                    eq(fileObject.status, "stored"),
                    isNull(fileObject.organizationId),
                    or(isNull(fileObject.userId), eq(fileObject.userId, userId)),
                  ),
                )
                .returning({ id: fileObject.id })
                .pipe(mapDatabaseErrors())
              if (!file) return yield* new InvalidImage()
              const image = avatarFileUrl(fileId)
              yield* tx
                .update(user)
                .set({ image, avatarFileId: fileId })
                .where(eq(user.id, userId))
                .pipe(mapDatabaseErrors())
              return image
            }),
          )
          .pipe(mapDatabaseErrors())
      })
      const importImage = Effect.fn("ProfileFiles.importImage")(function* (
        input: ImageImportInput,
      ) {
        const { kind } = input
        const ownerId = kind === "avatar" ? input.userId : input.ownerId
        const pendingLogo = and(
          eq(organization.id, ownerId),
          kind === "logo" ? eq(organization.logoImportGeneration, input.generation) : undefined,
          isNotNull(organization.logoImportSourceUrl),
        )
        let source: string
        if (kind === "avatar") {
          const [owner] = yield* db
            .select({ id: user.id })
            .from(user)
            .where(eq(user.id, ownerId))
            .pipe(mapDatabaseErrors())
          if (!owner) return "done" as const
          source = `https://gravatar.com/avatar/${input.emailHash}?d=404&r=g&s=128`
        } else {
          const [owner] = yield* db
            .select({ source: organization.logoImportSourceUrl })
            .from(organization)
            .where(pendingLogo)
            .pipe(mapDatabaseErrors())
          if (!owner?.source) return "done" as const
          source = owner.source
        }
        const result = yield* Effect.gen(function* () {
          const image = yield* sources.fetch({ source })
          const file = yield* files.upload(image)
          if (kind === "avatar") yield* setAvatar({ userId: ownerId, fileId: file.id })
          else
            yield* setLogo({
              organizationId: ownerId,
              fileId: file.id,
              generation: input.generation,
            })
        }).pipe(Effect.result)
        if (Result.isSuccess(result)) return "done" as const
        const error = result.failure
        yield* Effect.logWarning("Profile image import failed", { kind, reason: error._tag })
        if (error instanceof StorageUnavailable || error instanceof StorageObjectMissing)
          return "storage" as const
        if (error instanceof ImageImportUnavailable && input.attempts < 7) return "retry" as const
        if (kind === "logo")
          yield* db
            .update(organization)
            .set({ logoImportSourceUrl: null })
            .where(pendingLogo)
            .pipe(mapDatabaseErrors())
        return "done" as const
      })
      return ProfileFiles.of({
        uploadAvatar,
        setAvatar,
        validateAvatar,
        validateLogo,
        uploadLogo,
        attachLogo,
        setLogo,
        importImage,
      })
    }),
  )
  static readonly layer = ProfileFiles.layerNoDeps.pipe(
    Layer.provide([
      Database.layer,
      StoredFiles.layer,
      ImageSources.layer,
      DatabaseRateLimiter.layer,
    ]),
  )
}
