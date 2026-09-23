import {
  type CSSProperties,
  type ForwardedRef,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react"
import {
  type AstralBeamListingHandle,
  type AstralBeamTenantListHandle,
  type AstralBeamTenantUserListHandle,
  mountAstralBeamTenantList,
  type MountAstralBeamTenantListOptions,
  mountAstralBeamTenantUserList,
  type MountAstralBeamTenantUserListOptions,
} from "@astralbeam/sdk/client"

type ContainerProps = { className?: string | undefined; style?: CSSProperties | undefined }
export type AstralBeamTenantListProps = MountAstralBeamTenantListOptions & ContainerProps
export type AstralBeamTenantUserListProps = MountAstralBeamTenantUserListOptions & ContainerProps

export const AstralBeamTenantList = forwardRef<
  AstralBeamTenantListHandle,
  AstralBeamTenantListProps
>(function AstralBeamTenantList({ className, style, ...options }, ref) {
  const target = useListingMount(mountAstralBeamTenantList, options, ref)
  return <div ref={target} className={className} style={style} />
})

export const AstralBeamTenantUserList = forwardRef<
  AstralBeamTenantUserListHandle,
  AstralBeamTenantUserListProps
>(function AstralBeamTenantUserList({ className, style, ...options }, ref) {
  const target = useListingMount(mountAstralBeamTenantUserList, options, ref)
  return <div ref={target} className={className} style={style} />
})

function useListingMount<
  T extends MountAstralBeamTenantListOptions & MountAstralBeamTenantUserListOptions,
>(
  mount: (target: HTMLElement, options: T) => AstralBeamListingHandle<T>,
  options: T,
  ref: ForwardedRef<AstralBeamListingHandle<T>>,
) {
  const target = useRef<HTMLDivElement>(null)
  const handle = useRef<AstralBeamListingHandle<T> | null>(null)
  const {
    apiUrl,
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
  const live = useMemo(() => ({
    apiUrl,
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
  }) as T, [
    apiUrl,
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
  ])
  const liveRef = useRef(live)
  useEffect(() => {
    liveRef.current = live
  })
  useEffect(() => {
    const mounted = mount(target.current!, liveRef.current)
    handle.current = mounted
    return () => {
      handle.current = null
      mounted.unmount()
    }
  }, [mount])
  useEffect(() => {
    handle.current?.update(live)
  }, [live])
  useImperativeHandle(ref, () => ({
    update: (next) => handle.current?.update(next),
    refresh: () => handle.current?.refresh(),
    reset: () => handle.current?.reset(),
    unmount: () => handle.current?.unmount(),
  }), [])
  return target
}
