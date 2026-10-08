import { and, eq, isNull, isNotNull, lte, sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"

import { Database } from "@/db/database.server"
import { mapDatabaseErrors } from "@/db/lib/sqlstate.server"
import { user } from "@/db/schema/authentication.server"
import {
  fileObject,
  organizationImageImport,
  organizationLogo,
  userAvatar,
  userImageImport,
} from "@/db/schema/files.server"
import { organization } from "@/db/schema/organizations.server"
import { getGravatarAvatarUrl } from "@/lib/utils"
import {
  ImageImportUnavailable,
  ImageSourceMissing,
  InvalidImage,
  StorageObjectMissing,
  StorageUnavailable,
} from "./errors"
import { ImageSources } from "./image-source.server"
import {
  avatarFileId,
  avatarFileUrl,
  embeddedImage,
  fileSha256,
  logoFileUrl,
  verifiedImage,
} from "./images"
import { StoredFiles } from "./stored-files.server"

type ProfileFileFailure =
  | InvalidImage
  | StorageUnavailable
  | StorageObjectMissing
  | ImageImportUnavailable
  | ImageSourceMissing
type ImageOwner = { kind: "avatar" | "logo"; id: string }

export class ProfileFiles extends Context.Service<
  ProfileFiles,
  {
    readonly uploadAvatar: (
      userId: string,
      bytes: Uint8Array,
    ) => Effect.Effect<string, InvalidImage | StorageUnavailable | StorageObjectMissing>
    readonly validateAvatar: (
      userId: string,
      image: string | null | undefined,
    ) => Effect.Effect<void, InvalidImage>
    readonly validateLogo: (
      organizationId: string,
      image: string,
    ) => Effect.Effect<void, InvalidImage>
    readonly prepareLogo: (
      source: string,
    ) => Effect.Effect<string, InvalidImage | StorageUnavailable | StorageObjectMissing>
    readonly attachLogo: (organizationId: string, fileId: string) => Effect.Effect<string>
    readonly adoptLogo: (organizationId: string, fileId: string) => Effect.Effect<string>
    readonly queueAvatar: (input: {
      userId: string
      email: string
      source?: string
    }) => Effect.Effect<void>
    readonly queueLogo: (
      organizationId: string,
      source: string,
      expectedLogo: string | null,
    ) => Effect.Effect<void>
    readonly processImports: Effect.Effect<void>
    readonly migrate: (
      owner: ImageOwner,
      source: string | null,
      email?: string,
    ) => Effect.Effect<"migrated" | "unavailable" | "unchanged", ProfileFileFailure>
  }
>()("astralbeam/storage/ProfileFiles") {
  static readonly layerNoDeps = Layer.effect(
    ProfileFiles,
    Effect.gen(function* () {
      const db = yield* Database
      const files = yield* StoredFiles
      const sources = yield* ImageSources
      const ownedAvatar = (userId: string, image: string) =>
        db
          .select({ id: fileObject.id })
          .from(userAvatar)
          .innerJoin(fileObject, eq(fileObject.id, userAvatar.id))
          .where(
            and(
              eq(userAvatar.userId, userId),
              eq(userAvatar.id, avatarFileId(image) ?? "00000000-0000-0000-0000-000000000000"),
              isNotNull(fileObject.verifiedAt),
            ),
          )
          .limit(1)
          .pipe(mapDatabaseErrors())
      const validateAvatar = Effect.fn("ProfileFiles.validateAvatar")(function* (
        userId: string,
        image: string | null | undefined,
      ) {
        if (image == null) return
        if (!avatarFileId(image) || !(yield* ownedAvatar(userId, image)).length)
          return yield* new InvalidImage()
      })
      const validateLogo = Effect.fn("ProfileFiles.validateLogo")(function* (
        organizationId: string,
        image: string,
      ) {
        const [row] = yield* db
          .select({ id: fileObject.id })
          .from(organizationLogo)
          .innerJoin(fileObject, eq(fileObject.id, organizationLogo.id))
          .where(
            and(
              eq(organizationLogo.organizationId, organizationId),
              sql`${image} = '/api/files/organizations/' || ${organizationLogo.organizationId} || '/logos/' || ${organizationLogo.id}`,
              isNotNull(fileObject.verifiedAt),
            ),
          )
          .limit(1)
          .pipe(mapDatabaseErrors())
        if (!row) return yield* new InvalidImage()
      })
      const uploadAvatar = Effect.fn("ProfileFiles.uploadAvatar")(function* (
        userId: string,
        bytes: Uint8Array,
      ) {
        const image = yield* verifiedImage(bytes)
        const file = yield* files.prepare(image)
        yield* db
          .insert(userAvatar)
          .values({ userId, id: file.id, sourceKind: "manual" })
          .pipe(mapDatabaseErrors())
        return avatarFileUrl(file.id)
      })
      const prepareLogo = Effect.fn("ProfileFiles.prepareLogo")(function* (source: string) {
        const image = yield* embeddedImage(source)
        return (yield* files.prepare(image)).id
      })
      const attachLogo = Effect.fn("ProfileFiles.attachLogo")(function* (
        organizationId: string,
        fileId: string,
      ) {
        yield* db
          .insert(organizationLogo)
          .values({ organizationId, id: fileId })
          .onConflictDoNothing()
          .pipe(mapDatabaseErrors())
        return logoFileUrl(organizationId, fileId)
      })
      const adoptLogo = Effect.fn("ProfileFiles.adoptLogo")(function* (
        organizationId: string,
        fileId: string,
      ) {
        const image = yield* attachLogo(organizationId, fileId)
        yield* db
          .update(organization)
          .set({ logo: image })
          .where(and(eq(organization.id, organizationId), isNull(organization.logo)))
          .pipe(mapDatabaseErrors())
        return image
      })
      const queueAvatar = Effect.fn("ProfileFiles.queueAvatar")(function* (input: {
        userId: string
        email: string
        source?: string
      }) {
        const source =
          input.source ?? (yield* Effect.promise(() => getGravatarAvatarUrl(input.email)))
        if (!source) return
        yield* db
          .transaction((tx) =>
            Effect.gen(function* () {
              const [owner] = yield* tx
                .select()
                .from(user)
                .where(eq(user.id, input.userId))
                .for("update")
                .pipe(mapDatabaseErrors())
              if (
                !owner ||
                (!input.source && owner.image) ||
                (owner.image && !avatarFileId(owner.image))
              )
                return
              const [prior] = yield* tx
                .select()
                .from(userImageImport)
                .where(eq(userImageImport.userId, input.userId))
                .pipe(mapDatabaseErrors())
              const [avatar] = yield* tx
                .select()
                .from(userAvatar)
                .where(
                  and(
                    eq(userAvatar.userId, input.userId),
                    sql`${owner.image} = '/api/files/avatars/' || ${userAvatar.id}`,
                  ),
                )
                .pipe(mapDatabaseErrors())
              if (
                avatar?.sourceKind === "manual" ||
                prior?.status === "disabled" ||
                prior?.sourceUrl === source
              )
                return
              yield* tx
                .insert(userImageImport)
                .values({
                  userId: input.userId,
                  sourceUrl: source,
                  expectedImage: owner.image,
                  status: "pending",
                })
                .onConflictDoUpdate({
                  target: userImageImport.userId,
                  set: {
                    sourceUrl: source,
                    expectedImage: owner.image,
                    generation: sql`uuidv7()`,
                    status: "pending",
                    reason: null,
                    attempts: 0,
                    retryAt: sql`now()`,
                  },
                })
                .pipe(mapDatabaseErrors())
            }),
          )
          .pipe(mapDatabaseErrors())
      })
      const queueLogo = Effect.fn("ProfileFiles.queueLogo")(function* (
        organizationId: string,
        source: string,
        expectedLogo: string | null,
      ) {
        yield* db
          .transaction((tx) =>
            Effect.gen(function* () {
              const [owner] = yield* tx
                .select()
                .from(organization)
                .where(eq(organization.id, organizationId))
                .for("update")
                .pipe(mapDatabaseErrors())
              if (!owner || owner.logo !== expectedLogo) return
              yield* tx
                .insert(organizationImageImport)
                .values({
                  organizationId,
                  sourceUrl: source,
                  expectedLogo: owner.logo,
                  status: "pending",
                })
                .onConflictDoUpdate({
                  target: organizationImageImport.organizationId,
                  set: {
                    sourceUrl: source,
                    expectedLogo: owner.logo,
                    generation: sql`uuidv7()`,
                    status: "pending",
                    reason: null,
                    attempts: 0,
                    retryAt: sql`now()`,
                  },
                  setWhere: sql`${organizationImageImport.sourceUrl} <> ${source}`,
                })
                .pipe(mapDatabaseErrors())
            }),
          )
          .pipe(mapDatabaseErrors())
      })
      const prepareImportedProfileImage = Effect.fn("ProfileFiles.prepareImportedImage")(function* (
        source: string,
        identity: string,
      ) {
        const prepared = yield* files.resume(identity)
        if (prepared) return prepared
        const image = yield* sources.fetch(source)
        return yield* files.prepare({ ...image, sourceIdentity: identity })
      })
      const importAvatar = Effect.fn("ProfileFiles.importAvatar")(function* (
        pending: typeof userImageImport.$inferSelect,
      ) {
        if (!pending.sourceUrl) return
        const sourceUrl = pending.sourceUrl
        const file = yield* prepareImportedProfileImage(
          pending.sourceUrl,
          `avatar:${pending.userId}:${pending.generation}`,
        )
        yield* db
          .transaction((tx) =>
            Effect.gen(function* () {
              const [owner] = yield* tx
                .select()
                .from(user)
                .where(eq(user.id, pending.userId))
                .for("update")
                .pipe(mapDatabaseErrors())
              const [current] = yield* tx
                .select()
                .from(userImageImport)
                .where(
                  and(
                    eq(userImageImport.userId, pending.userId),
                    eq(userImageImport.generation, pending.generation),
                    eq(userImageImport.status, "pending"),
                  ),
                )
                .pipe(mapDatabaseErrors())
              if (!owner || !current) return
              if (owner.image !== pending.expectedImage) {
                yield* tx
                  .update(userImageImport)
                  .set({ status: "superseded", reason: "NewerImage" })
                  .where(
                    and(
                      eq(userImageImport.userId, pending.userId),
                      eq(userImageImport.generation, pending.generation),
                    ),
                  )
                  .pipe(mapDatabaseErrors())
                return
              }
              yield* tx
                .insert(userAvatar)
                .values({
                  userId: owner.id,
                  id: file.id,
                  sourceKind: sourceUrl.startsWith("https://gravatar.com/")
                    ? "gravatar"
                    : "external",
                })
                .onConflictDoNothing()
                .pipe(mapDatabaseErrors())
              yield* tx
                .update(user)
                .set({ image: avatarFileUrl(file.id) })
                .where(eq(user.id, owner.id))
                .pipe(mapDatabaseErrors())
              yield* tx
                .update(userImageImport)
                .set({ status: "imported", reason: null })
                .where(eq(userImageImport.userId, owner.id))
                .pipe(mapDatabaseErrors())
            }),
          )
          .pipe(mapDatabaseErrors())
      })
      const importLogo = Effect.fn("ProfileFiles.importLogo")(function* (
        pending: typeof organizationImageImport.$inferSelect,
      ) {
        const file = yield* prepareImportedProfileImage(
          pending.sourceUrl,
          `logo:${pending.organizationId}:${pending.generation}`,
        )
        yield* db
          .transaction((tx) =>
            Effect.gen(function* () {
              const [owner] = yield* tx
                .select()
                .from(organization)
                .where(eq(organization.id, pending.organizationId))
                .for("update")
                .pipe(mapDatabaseErrors())
              const [current] = yield* tx
                .select()
                .from(organizationImageImport)
                .where(
                  and(
                    eq(organizationImageImport.organizationId, pending.organizationId),
                    eq(organizationImageImport.generation, pending.generation),
                    eq(organizationImageImport.status, "pending"),
                  ),
                )
                .pipe(mapDatabaseErrors())
              if (!owner || !current) return
              if (owner.logo !== pending.expectedLogo) {
                yield* tx
                  .update(organizationImageImport)
                  .set({ status: "superseded", reason: "NewerImage" })
                  .where(
                    and(
                      eq(organizationImageImport.organizationId, pending.organizationId),
                      eq(organizationImageImport.generation, pending.generation),
                    ),
                  )
                  .pipe(mapDatabaseErrors())
                return
              }
              yield* tx
                .insert(organizationLogo)
                .values({ organizationId: owner.id, id: file.id })
                .onConflictDoNothing()
                .pipe(mapDatabaseErrors())
              yield* tx
                .update(organization)
                .set({ logo: logoFileUrl(owner.id, file.id) })
                .where(eq(organization.id, owner.id))
                .pipe(mapDatabaseErrors())
              yield* tx
                .update(organizationImageImport)
                .set({ status: "imported", reason: null })
                .where(eq(organizationImageImport.organizationId, owner.id))
                .pipe(mapDatabaseErrors())
            }),
          )
          .pipe(mapDatabaseErrors())
      })
      const processImports = Effect.gen(function* () {
        const avatars = yield* db
          .select()
          .from(userImageImport)
          .where(
            and(eq(userImageImport.status, "pending"), lte(userImageImport.retryAt, sql`now()`)),
          )
          .limit(20)
          .pipe(mapDatabaseErrors())
        for (const pending of avatars)
          yield* importAvatar(pending).pipe(
            Effect.catch((error) =>
              db
                .update(userImageImport)
                .set({
                  status:
                    error instanceof ImageSourceMissing || error instanceof InvalidImage
                      ? "unavailable"
                      : "pending",
                  reason: error._tag,
                  attempts: sql`${userImageImport.attempts} + 1`,
                  retryAt: sql`now() + interval '5 minutes'`,
                })
                .where(
                  and(
                    eq(userImageImport.userId, pending.userId),
                    eq(userImageImport.generation, pending.generation),
                    eq(userImageImport.status, "pending"),
                  ),
                )
                .pipe(mapDatabaseErrors(), Effect.asVoid),
            ),
          )
        const logos = yield* db
          .select()
          .from(organizationImageImport)
          .where(
            and(
              eq(organizationImageImport.status, "pending"),
              lte(organizationImageImport.retryAt, sql`now()`),
            ),
          )
          .limit(20)
          .pipe(mapDatabaseErrors())
        for (const pending of logos)
          yield* importLogo(pending).pipe(
            Effect.catch((error) =>
              db
                .update(organizationImageImport)
                .set({
                  status:
                    error instanceof ImageSourceMissing || error instanceof InvalidImage
                      ? "unavailable"
                      : "pending",
                  reason: error._tag,
                  attempts: sql`${organizationImageImport.attempts} + 1`,
                  retryAt: sql`now() + interval '5 minutes'`,
                })
                .where(
                  and(
                    eq(organizationImageImport.organizationId, pending.organizationId),
                    eq(organizationImageImport.generation, pending.generation),
                    eq(organizationImageImport.status, "pending"),
                  ),
                )
                .pipe(mapDatabaseErrors(), Effect.asVoid),
            ),
          )
        if (avatars.length || logos.length)
          yield* Effect.logInfo("Profile image imports processed", {
            avatars: avatars.length,
            logos: logos.length,
          })
      })
      const migrate = Effect.fn("ProfileFiles.migrate")(function* (
        owner: ImageOwner,
        source: string | null,
        email?: string,
      ) {
        if (source?.startsWith("/api/files/")) return "unchanged" as const
        if (!source && owner.kind === "logo") return "unchanged" as const
        if (!source) {
          const [prior] = yield* db
            .select()
            .from(userImageImport)
            .where(eq(userImageImport.userId, owner.id))
            .pipe(mapDatabaseErrors())
          if (prior && ["unavailable", "disabled", "imported"].includes(prior.status))
            return "unchanged" as const
        }
        const importSource = source ?? (yield* Effect.promise(() => getGravatarAvatarUrl(email!)))
        if (!importSource) return yield* new InvalidImage()
        const identity = `${owner.kind}:${owner.id}:${yield* fileSha256(new TextEncoder().encode(importSource))}`
        let file = yield* files.resume(identity)
        if (!file) {
          const image = yield* (
            importSource.startsWith("data:")
              ? embeddedImage(importSource)
              : sources.fetch(importSource)
          ).pipe(Effect.catchTag("ImageSourceMissing", () => Effect.succeed(null)))
          file = image ? yield* files.prepare({ ...image, sourceIdentity: identity }) : null
        }
        const result = yield* db
          .transaction((tx) =>
            Effect.gen(function* () {
              if (owner.kind === "avatar") {
                const [current] = yield* tx
                  .select()
                  .from(user)
                  .where(eq(user.id, owner.id))
                  .for("update")
                  .pipe(mapDatabaseErrors())
                if (!current || current.image !== source) return "unchanged" as const
                if (file)
                  yield* tx
                    .insert(userAvatar)
                    .values({
                      userId: owner.id,
                      id: file.id,
                      sourceKind: !source
                        ? "gravatar"
                        : source.startsWith("data:")
                          ? "manual"
                          : "external",
                    })
                    .onConflictDoNothing()
                    .pipe(mapDatabaseErrors())
                yield* tx
                  .update(user)
                  .set({ image: file ? avatarFileUrl(file.id) : null })
                  .where(eq(user.id, owner.id))
                  .pipe(mapDatabaseErrors())
                if (!importSource.startsWith("data:"))
                  yield* tx
                    .insert(userImageImport)
                    .values({
                      userId: owner.id,
                      sourceUrl: importSource,
                      expectedImage: source,
                      status: file ? "imported" : "unavailable",
                      reason: file ? null : "ImageSourceMissing",
                    })
                    .onConflictDoUpdate({
                      target: userImageImport.userId,
                      set: {
                        sourceUrl: importSource,
                        status: file ? "imported" : "unavailable",
                        reason: file ? null : "ImageSourceMissing",
                      },
                    })
                    .pipe(mapDatabaseErrors())
              } else {
                const [current] = yield* tx
                  .select()
                  .from(organization)
                  .where(eq(organization.id, owner.id))
                  .for("update")
                  .pipe(mapDatabaseErrors())
                if (!current || current.logo !== source) return "unchanged" as const
                if (file)
                  yield* tx
                    .insert(organizationLogo)
                    .values({ organizationId: owner.id, id: file.id })
                    .onConflictDoNothing()
                    .pipe(mapDatabaseErrors())
                yield* tx
                  .update(organization)
                  .set({ logo: file ? logoFileUrl(owner.id, file.id) : null })
                  .where(eq(organization.id, owner.id))
                  .pipe(mapDatabaseErrors())
                if (!importSource.startsWith("data:"))
                  yield* tx
                    .insert(organizationImageImport)
                    .values({
                      organizationId: owner.id,
                      sourceUrl: importSource,
                      expectedLogo: source,
                      status: file ? "imported" : "unavailable",
                      reason: file ? null : "ImageSourceMissing",
                    })
                    .onConflictDoUpdate({
                      target: organizationImageImport.organizationId,
                      set: {
                        sourceUrl: importSource,
                        status: file ? "imported" : "unavailable",
                        reason: file ? null : "ImageSourceMissing",
                      },
                    })
                    .pipe(mapDatabaseErrors())
              }
              return file ? ("migrated" as const) : ("unavailable" as const)
            }),
          )
          .pipe(mapDatabaseErrors())
        return result
      })
      return ProfileFiles.of({
        uploadAvatar,
        validateAvatar,
        validateLogo,
        prepareLogo,
        attachLogo,
        adoptLogo,
        queueAvatar,
        queueLogo,
        processImports,
        migrate,
      })
    }),
  )
  static readonly layer = ProfileFiles.layerNoDeps.pipe(
    Layer.provide([Database.layer, StoredFiles.layer, ImageSources.layer]),
  )
}
