export function getUserIdFromToken(): string {
  try {
    const token = localStorage.getItem("fabricpro_token");
    if (!token) return "guest";
    const payload = JSON.parse(atob(token.split(".")[1]));
    return String(payload.id || payload.sub || "guest");
  } catch {
    return "guest";
  }
}

export function setFabricproToken(token: string) {
  localStorage.setItem("fabricpro_token", token);
  window.dispatchEvent(new CustomEvent("fabricpro_auth_change"));
}

export function clearFabricproToken() {
  localStorage.removeItem("fabricpro_token");
  window.dispatchEvent(new CustomEvent("fabricpro_auth_change"));
}
