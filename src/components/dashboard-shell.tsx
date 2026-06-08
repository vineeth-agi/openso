"use client";

import * as React from "react";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import {
  Bot,
  Brain,
  Briefcase,
  ChevronRight,
  ChevronsUpDown,
  FolderGit2,
  History,
  LayoutTemplate,
  LogOut,
  MessageSquare,
  MessageSquareText,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Plug,
  Settings,
  Telescope,
  Timer,
  Trash2,
  User,
} from "lucide-react";


import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { broadcastAuthEvent, subscribeAuthEvents } from "@/lib/auth/broadcast";
import { cn } from "@/lib/utils";

// ── Types ──
type NavItem = {
  label: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  href: string;
  children?: NavItem[];
};

type NavGroup = {
  title: string;
  items: NavItem[];
  defaultOpen?: boolean;
};

// ── Shared navigation (always visible) ──
const sharedOverview: NavGroup = {
  title: "Overview",
  defaultOpen: true,
  items: [
    { label: "Connectors", icon: Plug, href: "/connectors" },
    { label: "New Chat", icon: MessageSquareText, href: "/chat" },
  ],
};

const sharedTools: NavGroup = {
  title: "Tools",
  defaultOpen: true,
  items: [
    { label: "Create Portfolio", icon: LayoutTemplate, href: "/portfolio-settings" },
    { label: "Open Source Repos", icon: FolderGit2, href: "/open-source" },
    { label: "Find Issues", icon: Telescope, href: "/open-source-issues" },
    { label: "Memory", icon: Brain, href: "/memory-brain" },
  ],
};

const mainNav: NavGroup[] = [
  sharedOverview,
  sharedTools,
];

// Build breadcrumb map from all possible nav groups
function buildBreadcrumbs(
  groups: NavGroup[]
): Record<string, { group: string; label: string }> {
  const map: Record<string, { group: string; label: string }> = {};
  groups.forEach((group) => {
    group.items.forEach((item) => {
      map[item.href] = { group: group.title, label: item.label };
      item.children?.forEach((child) => {
        map[child.href] = { group: group.title, label: child.label };
      });
    });
  });
  return map;
}

const allBreadcrumbs = buildBreadcrumbs(mainNav);

// ── Sub-components ──
const SidebarLogo = () => {
  const { toggleSidebar } = useSidebar();

  return (
  <SidebarMenu>
    <SidebarMenuItem>
      <div className="flex items-center justify-between w-full">
        <SidebarMenuButton size="lg" className="flex-1">
          <div className="flex size-8 items-center justify-center rounded-lg overflow-hidden shrink-0">
            <Image
              src="/openso_logo.png"
              alt="Openso"
              width={32}
              height={32}
              className="object-contain"
            />
          </div>
          <div className="flex flex-col gap-0.5 leading-none">
            <span className="font-medium">Dashboard</span>
          </div>
        </SidebarMenuButton>
        <button
          type="button"
          onClick={toggleSidebar}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          aria-label="Collapse sidebar"
        >
          <PanelLeftClose className="size-4" />
        </button>
      </div>
    </SidebarMenuItem>
  </SidebarMenu>
  );
};

const NavMenuItem = ({
  item,
  pathname,
}: {
  item: NavItem;
  pathname: string;
}) => {
  const Icon = item.icon;
  const hasChildren = item.children && item.children.length > 0;
  const isActive = pathname === item.href;
  const { isMobile, setOpenMobile } = useSidebar();

  const handleNavClick = () => {
    // Close the mobile sheet on navigation tap (within 300ms)
    if (isMobile) {
      setOpenMobile(false);
    }
  };

  if (!hasChildren) {
    return (
      <SidebarMenuItem>
        <SidebarMenuButton asChild isActive={isActive}>
          <Link href={item.href} onClick={handleNavClick}>
            <Icon className="size-4" />
            <span>{item.label}</span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }

  return (
    <Collapsible defaultOpen className="group/collapsible">
      <SidebarMenuItem>
        <CollapsibleTrigger className="w-full">
          <SidebarMenuButton isActive={isActive}>
            <Icon className="size-4" />
            <span>{item.label}</span>
            <ChevronRight className="ml-auto size-4 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {item.children!.map((child) => (
              <SidebarMenuSubItem key={child.label}>
                <SidebarMenuSubButton
                  asChild
                  isActive={pathname === child.href}
                >
                  <Link href={child.href} onClick={handleNavClick}>
                    <span className="w-full">{child.label}</span>
                  </Link>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
};

const NavUser = ({
  user,
}: {
  user: { name: string; email: string; avatar: string };
}) => {
  const router = useRouter();

  const handleLogout = async () => {
    // Clear app-managed httpOnly cookies via our server endpoint.
    // The SDK's `auth.signOut()` cannot reach our cookies (httpOnly)
    // and cannot reach InsForge cross-origin without a bearer.
    try {
      await fetch("/api/auth/signout", {
        method: "POST",
        credentials: "same-origin",
      });
    } catch (err) {
      console.warn("Sign-out request failed", err);
    }
    // Tell every other open tab the session is gone so they stop
    // showing authenticated UI immediately (audit Finding 1.4).
    broadcastAuthEvent({ type: "signed-out" });
    router.push("/signin");
  };

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild className="w-full">
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="size-8 rounded-lg">
                <AvatarImage src={user.avatar} alt={user.name} />
                <AvatarFallback className="rounded-lg">
                  {user.name
                    .split(" ")
                    .map((n) => n[0])
                    .join("")}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{user.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {user.email}
                </span>
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side="bottom"
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <Avatar className="size-8 rounded-lg">
                  <AvatarImage src={user.avatar} alt={user.name} />
                  <AvatarFallback className="rounded-lg">
                    {user.name
                      .split(" ")
                      .map((n) => n[0])
                      .join("")}
                  </AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{user.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {user.email}
                  </span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <User className="mr-2 size-4" />
              Account
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Settings className="mr-2 size-4" />
              Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout}>
              <LogOut className="mr-2 size-4" />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
};

// ── Chat History Section ──
interface ConversationItem {
  id: string;
  title: string;
  chatType: string;
  updatedAt: string;
}

function groupConversationsByDate(items: ConversationItem[]) {
  const groups: { [key: string]: ConversationItem[] } = {
    Today: [],
    Yesterday: [],
    "Last 7 days": [],
    "Last 30 days": [],
    Older: [],
  };

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;
  const sevenDaysAgo = todayStart - 6 * 24 * 60 * 60 * 1000;
  const thirtyDaysAgo = todayStart - 29 * 24 * 60 * 60 * 1000;

  items.forEach((item) => {
    const time = new Date(item.updatedAt).getTime();
    if (time >= todayStart) {
      groups["Today"].push(item);
    } else if (time >= yesterdayStart) {
      groups["Yesterday"].push(item);
    } else if (time >= sevenDaysAgo) {
      groups["Last 7 days"].push(item);
    } else if (time >= thirtyDaysAgo) {
      groups["Last 30 days"].push(item);
    } else {
      groups["Older"].push(item);
    }
  });

  return Object.keys(groups)
    .filter((key) => groups[key].length > 0)
    .map((key) => ({
      title: key,
      items: groups[key],
    }));
}

const ChatHistorySection = ({ pathname }: { pathname: string }) => {
  const [conversations, setConversations] = React.useState<ConversationItem[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const isOnChat = pathname.startsWith("/chat");
  const { isMobile, setOpenMobile } = useSidebar();
  const router = useRouter();

  const handleNavClick = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
  };

  const handleNewChatClick = (e: React.MouseEvent) => {
    e.preventDefault();
    const uuid = crypto.randomUUID();
    router.push(`/chat/${uuid}`);
    if (isMobile) {
      setOpenMobile(false);
    }
  };

  // Fetch conversations once on mount, then only when navigating TO a chat page
  // (avoids redundant API calls on every dashboard navigation).
  const hasFetched = React.useRef(false);
  const prevIsOnChat = React.useRef(false);

  React.useEffect(() => {
    const shouldFetch = isOnChat && (!hasFetched.current || (!prevIsOnChat.current && isOnChat));
    prevIsOnChat.current = isOnChat;

    if (!shouldFetch) return;
    hasFetched.current = true;

    setLoading(true);
    fetch("/api/conversations?type=mail&limit=50")
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (Array.isArray(data)) setConversations(data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [pathname, isOnChat]);

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    e.preventDefault();
    setDeletingId(id);
    try {
      const res = await fetch(`/api/conversations/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (res.ok) {
        setConversations((prev) => prev.filter((c) => c.id !== id));
      }
    } catch { /* ignore */ }
    setDeletingId(null);
  };

  // Extract active conversation ID from pathname
  const activeId = pathname.startsWith("/chat/") ? pathname.replace("/chat/", "") : "";

  return (
    <SidebarGroup className="flex flex-col flex-1 min-h-0 py-0">
      <div className="flex items-center justify-between px-2 py-0.5 shrink-0">
        <SidebarGroupLabel className="p-0 h-6 text-[11px] font-semibold text-sidebar-foreground/50 tracking-wider uppercase">Chat History</SidebarGroupLabel>
        <Link
          href="/chat"
          onClick={handleNewChatClick}
          className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          title="New Chat"
        >
          <Plus className="size-3.5" />
        </Link>
      </div>
      <SidebarGroupContent className="flex flex-col flex-1 min-h-0">
        <ScrollArea className="flex-1 min-h-0 w-full">
          <SidebarMenu>
            {loading ? (
              <div className="flex flex-col gap-1 px-2 py-2">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="h-7 animate-pulse rounded-md bg-sidebar-accent/40" />
                ))}
              </div>
            ) : conversations.length === 0 ? (
              <div className="px-3 py-4 text-center">
                <MessageSquare className="mx-auto size-5 text-muted-foreground/30" />
                <p className="mt-1 text-xs text-muted-foreground">No conversations yet</p>
              </div>
            ) : (
              groupConversationsByDate(conversations).map((group) => (
                <React.Fragment key={group.title}>
                  <div className="px-3 py-1.5 text-[9px] font-bold text-sidebar-foreground/40 uppercase tracking-wider select-none mt-2 first:mt-0">
                    {group.title}
                  </div>
                  {group.items.map((conv) => (
                    <SidebarMenuItem key={conv.id}>
                      <SidebarMenuButton
                        asChild
                        isActive={conv.id === activeId}
                        className="group/conv pr-1"
                      >
                        <Link href={`/chat/${conv.id}`} onClick={handleNavClick}>
                          <MessageSquare className="size-3.5 shrink-0" />
                          <span className="flex-1 truncate text-xs">{conv.title || "New Chat"}</span>
                          <button
                            type="button"
                            aria-label="Delete conversation"
                            onClick={(e) => handleDelete(e, conv.id)}
                            disabled={deletingId === conv.id}
                            className={cn(
                              "flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground/60 transition-all",
                              "opacity-0 group-hover/conv:opacity-100 hover:bg-destructive/10 hover:text-destructive",
                              deletingId === conv.id && "opacity-100 animate-pulse"
                            )}
                          >
                            <Trash2 className="size-3" />
                          </button>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </React.Fragment>
              ))
            )}
          </SidebarMenu>
        </ScrollArea>
      </SidebarGroupContent>
    </SidebarGroup>
  );
};

const AppSidebar = ({
  pathname,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  pathname: string;
}) => {
  const [user, setUser] = React.useState<{
    name: string;
    email: string;
    avatar: string;
  } | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    async function loadUser(reason: "initial" | "heartbeat") {
      try {
        // The browser cannot read the httpOnly `insforge_access_token`
        // cookie, and the SDK cannot reach InsForge cross-origin
        // without a bearer (browsers strip cookies on cross-site
        // requests). So we hit our same-origin /api/auth/me, which
        // reads the cookie server-side, forwards the bearer to
        // InsForge, and (since /api/auth/me uses getAuthUser) will
        // also rotate the access cookie via refresh-token exchange
        // when the access token has expired. This doubles as a
        // session-keep-alive so users on long chat pages don't hit
        // the 15-minute access-token cliff (audit Finding 1.3).
        const r = await fetch("/api/auth/me", {
          method: "GET",
          credentials: "same-origin",
          headers: { Accept: "application/json" },
          cache: "no-store",
        });
        if (cancelled) return;
        if (r.status === 401 && reason === "heartbeat") {
          // Refresh token also expired — treat as silent sign-out.
          // Avoid forcibly redirecting from a heartbeat (the user
          // might be filling a form). Middleware will catch on the
          // next nav.
          setUser(null);
          return;
        }
        if (!r.ok) return;
        const body = (await r.json()) as {
          user: { id: string; email?: string | null };
          profile: {
            full_name?: string | null;
            avatar_url?: string | null;
            email?: string | null;
          } | null;
        };
        if (cancelled || !body?.user) return;

        setUser({
          name:
            body.profile?.full_name ||
            body.user.email?.split("@")[0] ||
            "User",
          email: body.profile?.email || body.user.email || "",
          avatar: body.profile?.avatar_url || "",
        });
      } catch (err) {
        if (reason === "initial") {
          console.error("Failed to load user for sidebar:", err);
        }
      }
    }

    loadUser("initial");

    // Heartbeat: poll /api/auth/me every 10 minutes. Each successful
    // poll triggers refreshAccessTokenIfPossible() server-side when
    // the access token is expired, keeping the session warm without
    // the user having to navigate. 10min < 15min access TTL, with
    // headroom for a missed tick.
    const HEARTBEAT_MS = 10 * 60 * 1000;
    const intervalId = window.setInterval(() => loadUser("heartbeat"), HEARTBEAT_MS);

    // Also refresh when the tab becomes visible again — covers users
    // who left the tab idle for >10min and come back.
    const onVisible = () => {
      if (!cancelled && document.visibilityState === "visible") {
        loadUser("heartbeat");
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    // Cross-tab sync (audit Finding 1.4). Another tab told us the
    // session changed — refresh our local state without waiting for
    // the next heartbeat.
    const unsubscribeBroadcast = subscribeAuthEvents((event) => {
      if (cancelled) return;
      if (event.type === "signed-out") {
        // Drop the cached profile so the sidebar shows the loading
        // skeleton; the next nav will hit middleware which redirects
        // to /signin.
        setUser(null);
      } else if (event.type === "signed-in" || event.type === "session-refreshed") {
        loadUser("heartbeat");
      }
    });

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisible);
      unsubscribeBroadcast();
    };
  }, []);

  return (
    <Sidebar {...props}>
      <SidebarHeader>
        <SidebarLogo />
      </SidebarHeader>
      <SidebarContent className="flex flex-col h-full overflow-hidden gap-1">
        {mainNav.map((group) => (
          <SidebarGroup key={group.title} className="shrink-0 py-1">
            <SidebarGroupLabel className="h-6 text-[11px] font-semibold text-sidebar-foreground/50 tracking-wider uppercase">{group.title}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <NavMenuItem
                    key={item.label}
                    item={item}
                    pathname={pathname}
                  />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
        <ChatHistorySection pathname={pathname} />
      </SidebarContent>
      <SidebarFooter>
        {user ? (
          <NavUser user={user} />
        ) : (
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" className="pointer-events-none">
                <div className="size-8 animate-pulse rounded-lg bg-sidebar-accent/60" />
                <div className="grid flex-1 gap-1.5">
                  <div className="h-3 w-20 animate-pulse rounded bg-sidebar-accent/60" />
                  <div className="h-2.5 w-28 animate-pulse rounded bg-sidebar-accent/40" />
                </div>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        )}
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
};

// ── Floating chat controls (visible when sidebar is collapsed on chat pages) ──
const ChatFloatingControls = () => {
  const { state, toggleSidebar, isMobile, setOpenMobile } = useSidebar();
  const isCollapsed = state === "collapsed";
  const router = useRouter();

  // On mobile, the mobile header already provides the trigger.
  if (isMobile || !isCollapsed) return null;

  const handleNewChatClick = (e: React.MouseEvent) => {
    e.preventDefault();
    const id = crypto.randomUUID();
    router.push(`/chat/${id}`);
    if (isMobile) {
      setOpenMobile(false);
    }
  };

  return (
    <div className="absolute left-3 top-3 z-20 flex items-center gap-1 animate-in fade-in slide-in-from-left-2 duration-200">
      <button
        type="button"
        onClick={toggleSidebar}
        className="flex h-8 w-8 items-center justify-center rounded-lg bg-sidebar text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground shadow-sm border border-border/40"
        aria-label="Open sidebar"
      >
        <PanelLeftOpen className="size-4" />
      </button>
      <Link
        href="/chat"
        onClick={handleNewChatClick}
        className="flex h-8 w-8 items-center justify-center rounded-lg bg-sidebar text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground shadow-sm border border-border/40"
        title="New Chat"
      >
        <Plus className="size-4" />
      </Link>
    </div>
  );
};

// ── Generic floating sidebar trigger (for non-chat hideHeader pages on desktop) ──
const FloatingSidebarTrigger = () => {
  const { state, toggleSidebar, isMobile } = useSidebar();
  const isCollapsed = state === "collapsed";

  // On mobile, the mobile header already provides the trigger.
  if (isMobile || !isCollapsed) return null;

  return (
    <div className="absolute left-3 top-3 z-20 animate-in fade-in slide-in-from-left-2 duration-200">
      <button
        type="button"
        onClick={toggleSidebar}
        className="flex h-8 w-8 items-center justify-center rounded-lg bg-sidebar text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground shadow-sm border border-border/40"
        aria-label="Open sidebar"
      >
        <PanelLeftOpen className="size-4" />
      </button>
    </div>
  );
};

interface DashboardShellProps {
  className?: string;
  children: React.ReactNode;
}

export function DashboardShell({
  className,
  children,
}: DashboardShellProps) {
  const pathname = usePathname();

  const isChat = pathname.startsWith("/chat");
  const isPortfolioSettings = pathname === "/portfolio-settings";
  const isConnectors = pathname === "/connectors";
  const isOpenSource = pathname === "/open-source";
  const isOpenSourceIssues = pathname === "/open-source-issues";
  const isMemoryBrain = pathname === "/memory-brain";
  const isFullWidth = isChat || isPortfolioSettings;
  const hideHeader = isFullWidth || isConnectors || isOpenSource || isOpenSourceIssues || isMemoryBrain;

  const breadcrumb = allBreadcrumbs[pathname] || {
    group: "Dashboard",
    label:
      pathname
        .replace("/", "")
        .replace(/-/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase()) || "Home",
  };

  return (
    <SidebarProvider className={cn("h-full", className)}>
      <AppSidebar pathname={pathname} />
      <SidebarInset>
        {/* Header for non-fullWidth pages — always visible with breadcrumb on mobile */}
        {!hideHeader && (
          <header className="flex h-12 shrink-0 items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator
              orientation="vertical"
              className="mr-2 data-[orientation=vertical]:h-4"
            />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem className="hidden md:block">
                  <BreadcrumbLink href="#">{breadcrumb.group}</BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem>
                  <BreadcrumbPage>{breadcrumb.label}</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </header>
        )}
        {/* Mobile-only header for hideHeader pages — always shows sidebar toggle so users can reopen the menu */}
        {hideHeader && (
          <header className="flex h-12 shrink-0 items-center gap-2 px-4 md:hidden">
            <SidebarTrigger className="-ml-1" />
            <Separator
              orientation="vertical"
              className="mr-2 data-[orientation=vertical]:h-4"
            />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbPage>{breadcrumb.label}</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </header>
        )}
        <div className="relative flex flex-1 flex-col overflow-y-auto">
          {isChat && <ChatFloatingControls />}
          {!isChat && hideHeader && <FloatingSidebarTrigger />}
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
