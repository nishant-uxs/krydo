import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WalletProvider, useWallet } from "@/lib/wallet";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { WalletButton } from "@/components/wallet-button";
import { ThemeToggle } from "@/components/theme-toggle";
import NotFound from "@/pages/not-found";
import Landing from "@/pages/landing";
import Dashboard from "@/pages/dashboard";
import IssuersPage from "@/pages/issuers";
import IssueCredentialPage from "@/pages/issue-credential";
import CredentialsPage from "@/pages/credentials";
import VerifyPage from "@/pages/verify";
import TransactionsPage from "@/pages/transactions";
import ZkProofsPage from "@/pages/zk-proofs";
import RequestCredentialPage from "@/pages/request-credential";
import { useEffect } from "react";
import { Redirect } from "wouter";

function AuthenticatedLayout() {
  const { isConnected } = useWallet();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!isConnected) {
      navigate("/");
    }
  }, [isConnected, navigate]);

  if (!isConnected) return null;

  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AppSidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <header className="flex items-center justify-between gap-2 px-4 py-2 border-b bg-background/80 backdrop-blur-sm sticky top-0 z-40">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <WalletButton />
            </div>
          </header>
          <main className="flex-1 overflow-auto">
            <Switch>
              <Route path="/">
                <Redirect to="/dashboard" />
              </Route>
              <Route path="/dashboard" component={Dashboard} />
              <Route path="/issuers" component={IssuersPage} />
              <Route path="/issue" component={IssueCredentialPage} />
              <Route path="/request" component={RequestCredentialPage} />
              <Route path="/credentials" component={CredentialsPage} />
              <Route path="/verify" component={VerifyPage} />
              <Route path="/zk-proofs" component={ZkProofsPage} />
              <Route path="/transactions" component={TransactionsPage} />
              <Route>
                <Redirect to="/dashboard" />
              </Route>
            </Switch>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

function Router() {
  const { isConnected } = useWallet();
  const [location] = useLocation();

  if (!isConnected && location !== "/verify") {
    return <Landing />;
  }

  if (location === "/verify" && !isConnected) {
    return (
      <div className="min-h-screen bg-background">
        <header className="border-b bg-background/80 backdrop-blur-sm sticky top-0 z-40">
          <div className="max-w-2xl mx-auto flex items-center justify-between gap-2 px-6 py-3">
            <div className="flex items-center gap-2">
              <span className="font-serif font-bold text-lg">Krydo</span>
            </div>
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <WalletButton />
            </div>
          </div>
        </header>
        <VerifyPage />
      </div>
    );
  }

  return <AuthenticatedLayout />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WalletProvider>
          <Toaster />
          <Router />
        </WalletProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
