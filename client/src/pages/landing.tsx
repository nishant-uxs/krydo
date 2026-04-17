import { useWallet } from "@/lib/wallet";
import { useLocation } from "wouter";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Shield, Lock, Eye, ArrowRight, Wallet, Layers, CheckCircle2, Network, AlertTriangle } from "lucide-react";
import { SiEthereum } from "react-icons/si";
import { motion } from "framer-motion";

const fadeUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.5 },
};

const stagger = {
  animate: { transition: { staggerChildren: 0.1 } },
};

export default function Landing() {
  const { isConnected, isConnecting, hasMetaMask, connect } = useWallet();
  const [, navigate] = useLocation();
  const [showNoMetaMask, setShowNoMetaMask] = useState(false);

  useEffect(() => {
    if (isConnected) navigate("/dashboard");
  }, [isConnected, navigate]);

  const handleConnectClick = () => {
    if (!hasMetaMask) {
      setShowNoMetaMask(true);
      return;
    }
    connect();
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="fixed top-0 left-0 right-0 z-50 border-b bg-background/80 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-2 px-6 py-3">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" />
            <span className="font-serif font-bold text-lg tracking-tight">Krydo</span>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button onClick={handleConnectClick} disabled={isConnecting} data-testid="button-hero-connect">
              <SiEthereum className="w-4 h-4 mr-2" />
              {isConnecting ? "Detecting role..." : "Connect MetaMask"}
            </Button>
          </div>
        </div>
      </header>

      <main className="pt-20">
        <section className="max-w-6xl mx-auto px-6 py-24 md:py-32">
          <motion.div
            className="max-w-3xl"
            variants={stagger}
            initial="initial"
            animate="animate"
          >
            <motion.div variants={fadeUp}>
              <Badge variant="secondary" className="mb-6 no-default-active-elevate">
                Decentralized Trust Infrastructure
              </Badge>
            </motion.div>
            <motion.h1
              className="font-serif text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.1] mb-6"
              variants={fadeUp}
            >
              Prove financial credibility{" "}
              <span className="text-primary">without revealing</span>{" "}
              sensitive data
            </motion.h1>
            <motion.p
              className="text-lg text-muted-foreground max-w-2xl mb-8 leading-relaxed"
              variants={fadeUp}
            >
              Krydo is a privacy-preserving financial trust system built on blockchain infrastructure. 
              Institutions issue verifiable credentials. Users prove credibility. No sensitive data exposed.
            </motion.p>
            <motion.div className="flex flex-wrap items-center gap-3" variants={fadeUp}>
              <Button size="lg" onClick={handleConnectClick} disabled={isConnecting} data-testid="button-cta-connect">
                <SiEthereum className="w-4 h-4 mr-2" />
                {isConnecting ? "Detecting role..." : "Connect MetaMask"}
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
              <Button size="lg" variant="outline" onClick={() => navigate("/verify")} data-testid="button-cta-verify">
                <Eye className="w-4 h-4 mr-2" />
                Verify a Credential
              </Button>
            </motion.div>
          </motion.div>
        </section>

        <section className="max-w-6xl mx-auto px-6 pb-24">
          <motion.div
            className="grid grid-cols-1 md:grid-cols-3 gap-6"
            variants={stagger}
            initial="initial"
            whileInView="animate"
            viewport={{ once: true }}
          >
            <motion.div variants={fadeUp} className="p-6 rounded-md bg-card border border-card-border">
              <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center mb-4">
                <Layers className="w-5 h-5 text-primary" />
              </div>
              <h3 className="font-serif font-semibold text-lg mb-2">Hierarchical Trust</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Root Authority governs issuers. Issuers grant credentials. A transparent chain of trust enforced by smart contracts.
              </p>
            </motion.div>

            <motion.div variants={fadeUp} className="p-6 rounded-md bg-card border border-card-border">
              <div className="w-10 h-10 rounded-md bg-chart-3/10 flex items-center justify-center mb-4">
                <Lock className="w-5 h-5 text-chart-3" />
              </div>
              <h3 className="font-serif font-semibold text-lg mb-2">Privacy-Preserving</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Sensitive financial data never touches the blockchain. Only cryptographic hashes and references are stored on-chain.
              </p>
            </motion.div>

            <motion.div variants={fadeUp} className="p-6 rounded-md bg-card border border-card-border">
              <div className="w-10 h-10 rounded-md bg-chart-4/10 flex items-center justify-center mb-4">
                <CheckCircle2 className="w-5 h-5 text-chart-4" />
              </div>
              <h3 className="font-serif font-semibold text-lg mb-2">Instant Verification</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Anyone can verify credential authenticity without special permissions. Public verification, private data.
              </p>
            </motion.div>
          </motion.div>
        </section>

        <section className="border-t bg-card">
          <div className="max-w-6xl mx-auto px-6 py-20">
            <motion.div
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              className="text-center mb-12"
            >
              <h2 className="font-serif text-2xl md:text-3xl font-bold mb-3">Trust Architecture</h2>
              <p className="text-muted-foreground max-w-lg mx-auto">
                A hierarchical model inspired by central banking authority structures
              </p>
            </motion.div>

            <motion.div
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
              variants={stagger}
              initial="initial"
              whileInView="animate"
              viewport={{ once: true }}
            >
              {[
                { icon: Network, title: "Root Authority", desc: "Deploys contracts, governs the network, approves issuers", color: "text-chart-5" },
                { icon: Shield, title: "Issuers", desc: "Trusted institutions that issue and manage credentials", color: "text-chart-1" },
                { icon: Wallet, title: "Users", desc: "Wallet-identified participants who hold credentials", color: "text-chart-3" },
                { icon: Eye, title: "Verifiers", desc: "Services that verify credentials without special access", color: "text-chart-4" },
              ].map((item) => (
                <motion.div
                  key={item.title}
                  variants={fadeUp}
                  className="p-5 rounded-md border border-border bg-background"
                >
                  <item.icon className={`w-5 h-5 ${item.color} mb-3`} />
                  <h4 className="font-serif font-semibold mb-1">{item.title}</h4>
                  <p className="text-xs text-muted-foreground leading-relaxed">{item.desc}</p>
                </motion.div>
              ))}
            </motion.div>
          </div>
        </section>

        <Dialog open={showNoMetaMask} onOpenChange={setShowNoMetaMask}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="font-serif flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-chart-4" />
                MetaMask Required
              </DialogTitle>
              <DialogDescription>
                MetaMask browser extension is required to connect your wallet.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <a
                href="https://metamask.io/download/"
                target="_blank"
                rel="noopener noreferrer"
                className="block"
              >
                <Button className="w-full" data-testid="button-install-metamask">
                  <SiEthereum className="w-4 h-4 mr-2" />
                  Install MetaMask
                </Button>
              </a>
              <p className="text-xs text-center text-muted-foreground">
                After installing, refresh this page and try connecting again.
              </p>
            </div>
          </DialogContent>
        </Dialog>

        <footer className="border-t">
          <div className="max-w-6xl mx-auto px-6 py-8 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-primary" />
              <span className="font-serif font-semibold text-sm">Krydo</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Privacy-preserving financial trust infrastructure
            </p>
          </div>
        </footer>
      </main>
    </div>
  );
}
