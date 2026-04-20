import { Link, useLocation } from "wouter";
import { Sun, Moon, Menu, X, Sparkles, User, LayoutDashboard, LogOut, Rss, Crown, Briefcase, ClipboardList } from "lucide-react";
import { useState } from "react";
import { useTheme } from "./ThemeProvider";
import { useAuth } from "./AuthProvider";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import LoginModal from "./LoginModal";
import SignupModal from "./SignupModal";

export default function Navbar() {
  const { theme, toggle } = useTheme();
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [signupOpen, setSignupOpen] = useState(false);
  const [location] = useLocation();

  const navLinks = [
    { href: "/feed", label: "Feed", icon: Rss },
    { href: "/marketplace", label: "Browse Talent" },
    { href: "/ai-search", label: "AI Match", icon: Sparkles },
    { href: "/briefs", label: "Briefs", icon: ClipboardList },
    { href: "/your-work", label: "Your Work", icon: Briefcase },
  ];

  const isActive = (href: string) => location === href;

  return (
    <>
      <nav className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="flex h-16 items-center justify-between">
            {/* Logo */}
            <Link href="/" className="font-bold text-2xl">
              <span className="gradient-text">Viewrr</span>
            </Link>

            {/* Desktop nav */}
            <div className="hidden md:flex items-center gap-6 ml-14">
              {/* Pro Viewrr — special golden nav link, first position */}
              <Link
                href="/pro"
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition-all border ${
                  isActive("/pro")
                    ? "text-white border-transparent"
                    : "border-transparent hover:border-amber-400/40"
                }`}
                style={isActive("/pro")
                  ? { background: "linear-gradient(135deg, #FF5A1F, #FFA500)", color: "#fff", boxShadow: "0 2px 12px #FF5A1F44" }
                  : { background: "linear-gradient(135deg, #FF5A1F14, #FFA50014)", color: "#FF5A1F", borderColor: "#FF5A1F33" }
                }
                data-testid="nav-pro"
              >
                <Crown size={13} />
                Pro Viewrr
              </Link>

              {navLinks.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors
                    ${isActive(href)
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                    }`}
                >
                  {Icon && <Icon size={14} />}
                  {label}
                </Link>
              ))}
            </div>

            {/* Right side */}
            <div className="flex items-center gap-2">
              <button
                onClick={toggle}
                className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                aria-label="Toggle theme"
                data-testid="theme-toggle"
              >
                {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
              </button>

              {user ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="flex items-center gap-2 rounded-full" data-testid="user-menu">
                      <Avatar className="w-8 h-8">
                        <AvatarImage src={user.avatar || undefined} />
                        <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                          {user.name.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <div className="px-3 py-2">
                      <p className="text-sm font-medium">{user.name}</p>
                      <p className="text-xs text-muted-foreground capitalize">{user.role}</p>
                    </div>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                      <Link href="/dashboard" className="flex items-center gap-2 cursor-pointer">
                        <LayoutDashboard size={14} /> Dashboard
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={logout} className="text-destructive flex items-center gap-2">
                      <LogOut size={14} /> Sign out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <div className="hidden md:flex items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setLoginOpen(true)} data-testid="login-btn">
                    Sign in
                  </Button>
                  <Button size="sm" onClick={() => setSignupOpen(true)} data-testid="signup-btn"
                    className="bg-primary hover:bg-primary/90 text-white">
                    Get started
                  </Button>
                </div>
              )}

              {/* Mobile menu toggle */}
              <button
                className="md:hidden p-2 rounded-lg text-muted-foreground hover:bg-secondary"
                onClick={() => setMenuOpen(o => !o)}
                aria-label="Menu"
              >
                {menuOpen ? <X size={20} /> : <Menu size={20} />}
              </button>
            </div>
          </div>

          {/* Mobile menu */}
          {menuOpen && (
            <div className="md:hidden border-t border-border pb-4 pt-2 space-y-1">
              {/* Pro Viewrr mobile link */}
              <Link
                href="/pro"
                onClick={() => setMenuOpen(false)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold"
                style={{ color: "#FF5A1F", background: isActive("/pro") ? "linear-gradient(135deg,#FF5A1F,#FFA500)" : "linear-gradient(135deg,#FF5A1F12,#FFA50012)" }}
              >
                <Crown size={14} />
                Pro Viewrr
              </Link>
              {navLinks.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMenuOpen(false)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium
                    ${isActive(href) ? "bg-primary/10 text-primary" : "text-foreground"}`}
                >
                  {Icon && <Icon size={14} />}
                  {label}
                </Link>
              ))}
              {!user && (
                <div className="flex gap-2 px-3 pt-2">
                  <Button variant="outline" size="sm" onClick={() => { setLoginOpen(true); setMenuOpen(false); }}>Sign in</Button>
                  <Button size="sm" onClick={() => { setSignupOpen(true); setMenuOpen(false); }}
                    className="bg-primary hover:bg-primary/90 text-white">Get started</Button>
                </div>
              )}
            </div>
          )}
        </div>
      </nav>

      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
      <SignupModal open={signupOpen} onClose={() => setSignupOpen(false)} />
    </>
  );
}
