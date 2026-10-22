import {
  type CSSProperties,
  type ForwardedRef,
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react"
import {
  type AstralBeamListingHandle,
  mountAstralBeamThreadList,
  type MountAstralBeamThreadListOptions,
  mountAstralBeamTenantList,
  type MountAstralBeamTenantListOptions,
  mountAstralBeamTenantUserList,
  type MountAstralBeamTenantUserListOptions,
} from "@astralbeam/sdk/client"

type ContainerProps = { className?: string | undefined; style?: CSSProperties | undefined }
export type AstralBeamTenantListProps = MountAstralBeamTenantListOptions & ContainerProps
export type AstralBeamTenantUserListProps = MountAstralBeamTenantUserListOptions & ContainerProps

/** Directory actions. React props and rendering own options and mounting. */
type AstralBeamListingRef = Pick<AstralBeamListingHandle, "refresh" | "reset">
export type AstralBeamTenantListRef = AstralBeamListingRef
export type AstralBeamTenantUserListRef = AstralBeamListingRef
export type AstralBeamThreadListRef = AstralBeamListingRef

export const AstralBeamTenantList = forwardRef<AstralBeamTenantListRef, AstralBeamTenantListProps>(
  function AstralBeamTenantList({ className, style, ...options }, ref) {
    const target = useListingMount(mountAstralBeamTenantList, options, ref)
    return <div ref={target} className={className} style={style} />
  },
)

export const AstralBeamTenantUserList = forwardRef<
  AstralBeamTenantUserListRef,
  AstralBeamTenantUserListProps
>(function AstralBeamTenantUserList({ className, style, ...options }, ref) {
  const target = useListingMount(mountAstralBeamTenantUserList, options, ref)
  return <div ref={target} className={className} style={style} />
})

export type AstralBeamThreadListProps = MountAstralBeamThreadListOptions & ContainerProps
export const AstralBeamThreadList = forwardRef<AstralBeamThreadListRef, AstralBeamThreadListProps>(
  function AstralBeamThreadList({ className, style, ...options }, ref) {
    const target = useListingMount(mountAstralBeamThreadList, options, ref)
    return <div ref={target} className={className} style={style} />
  },
)

function useListingMount<
  T extends MountAstralBeamTenantListOptions & MountAstralBeamTenantUserListOptions,
>(
  mount: (target: HTMLElement, options: T) => AstralBeamListingHandle<T>,
  options: T,
  ref: ForwardedRef<AstralBeamListingRef>,
) {
  const target = useRef<HTMLDivElement>(null)
  const handle = useRef<AstralBeamListingHandle<T> | null>(null)
  const {
    apiUrl,
    cacheKey,
    fetchAstralBeamToken,
    scope,
    tenantId,
    tenantExternalId,
    showAdmin,
    pageSize,
    title,
    showHeader,
    customCss,
    colorScheme,
    theme,
    onError,
    onTenantChange,
    onTenantSelect,
    onTenantUserSelect,
  } = options
  const live = useMemo(
    () =>
      ({
        apiUrl,
        cacheKey,
        fetchAstralBeamToken,
        scope,
        tenantId,
        tenantExternalId,
        showAdmin,
        pageSize,
        title,
        showHeader,
        customCss,
        colorScheme,
        theme,
        onError,
        onTenantChange,
        onTenantSelect,
        onTenantUserSelect,
      }) as T,
    [
      apiUrl,
      cacheKey,
      fetchAstralBeamToken,
      scope,
      tenantId,
      tenantExternalId,
      showAdmin,
      pageSize,
      title,
      showHeader,
      customCss,
      colorScheme,
      theme,
      onError,
      onTenantChange,
      onTenantSelect,
      onTenantUserSelect,
    ],
  )
  const liveRef = useRef(live)
  useLayoutEffect(() => {
    liveRef.current = live
    handle.current?.update(live)
  }, [live])
  useLayoutEffect(() => {
    const mounted = mount(target.current!, liveRef.current)
    handle.current = mounted
    return () => {
      handle.current = null
      mounted.unmount()
    }
  }, [mount])
  useImperativeHandle(ref, () => {
    // Bind to this mount so retained refs cannot act on a later mount.
    const mounted = handle.current!
    return { refresh: () => mounted.refresh(), reset: () => mounted.reset() }
  }, [])
  return target
}
