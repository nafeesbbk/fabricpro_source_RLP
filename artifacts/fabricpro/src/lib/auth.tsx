import React, { useEffect, useState } from "react";
import { Link, useLocation, Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { useGetMe } from "@workspace/api-client-react";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const token = localStorage.getItem("fabricpro_token");

  if (!token) {
    return <Redirect to="/login" />;
  }

  return <>{children}</>;
}

export function ProtectedRoute({ component: Component, path }: { component: React.ComponentType<any>; path: string }) {
  return (
    <Route path={path}>
      <AuthGuard>
        <Component />
      </AuthGuard>
    </Route>
  );
}
