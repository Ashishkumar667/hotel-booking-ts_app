import { NextFunction, Request, Response } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";

declare global {
  namespace Express {
    interface Request {
      userId: string;
    }
  }
}

const verifyToken = (req: Request, res: Response, next: NextFunction) => {
  // Try to get token from either cookies or Authorization header
  console.log("Cookies received:", req.cookies); // Add this line
  console.log("Headers received:", req.headers);
  const token = req.cookies["auth_token"] || req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ 
      message: "Authentication required",
      details: "No token provided in cookies or Authorization header"
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY as string);
    req.userId = (decoded as JwtPayload).userId;
    next();
  } catch (error) {
    console.error("Token verification error:", error);
    
    let message = "Invalid token";
    if (error instanceof jwt.TokenExpiredError) {
      message = "Token expired";
    } else if (error instanceof jwt.JsonWebTokenError) {
      message = "Malformed token";
    }

    return res.status(401).json({ 
      message,
      // details: error.message 
    });
  }
};

export default verifyToken;