import { Navigate } from "react-router-dom";
import { ReactNode } from "react";

interface Props {
  children: ReactNode;
}

export const ProtectedRoute = ({ children }: Props) => {
  const authToken = localStorage.getItem("authToken");
  
  if (!authToken) {
    return <Navigate to="/auth/sign-in" replace />;
  }

  return <>{children}</>;
};
