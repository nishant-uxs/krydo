import { useWallet } from "@/lib/wallet";
import { useLocation, Link } from "wouter";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { Shield, LayoutDashboard, Users, FileCheck, Eye, Activity, Fingerprint, Send } from "lucide-react";
import { shortenAddress } from "@/lib/wallet";

export function AppSidebar() {
  const { address, role } = useWallet();
  const [location] = useLocation();

  const navItems = [
    { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard, roles: ["root", "issuer", "user"] },
    { title: "Manage Issuers", url: "/issuers", icon: Users, roles: ["root"] },
    { title: "Issue Credentials", url: "/issue", icon: FileCheck, roles: ["issuer"] },
    { title: "Request Credential", url: "/request", icon: Send, roles: ["user"] },
    { title: "My Credentials", url: "/credentials", icon: Shield, roles: ["user", "issuer"] },
    { title: "ZK Proofs", url: "/zk-proofs", icon: Fingerprint, roles: ["user", "issuer"] },
    { title: "Verify", url: "/verify", icon: Eye, roles: ["root", "issuer", "user"] },
    { title: "Transactions", url: "/transactions", icon: Activity, roles: ["root", "issuer", "user"] },
  ];

  const filteredItems = navItems.filter((item) => item.roles.includes(role || "user"));

  const roleColors: Record<string, string> = {
    root: "bg-chart-5/15 text-chart-5",
    issuer: "bg-chart-1/15 text-chart-1",
    user: "bg-chart-3/15 text-chart-3",
  };

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-primary" />
          <span className="font-serif font-bold text-lg tracking-tight">Krydo</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {filteredItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    data-active={location === item.url}
                    className="data-[active=true]:bg-sidebar-accent"
                  >
                    <Link href={item.url} data-testid={`nav-${item.title.toLowerCase().replace(/\s/g, "-")}`}>
                      <item.icon className="w-4 h-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-4">
        {address && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
              <span className="font-mono text-xs text-muted-foreground truncate">
                {shortenAddress(address)}
              </span>
            </div>
            <Badge
              variant="secondary"
              className={`text-[10px] no-default-active-elevate ${roleColors[role || "user"]}`}
            >
              {role === "root" ? "Root Authority" : role === "issuer" ? "Trusted Issuer" : "User"}
            </Badge>
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
