import { redirect } from "next/navigation";

export default function Home() {
  // The (dashboard) layout's own auth check decides from here whether that
  // actually renders or bounces to /login — this route is just the entry point.
  redirect("/dashboard");
}
