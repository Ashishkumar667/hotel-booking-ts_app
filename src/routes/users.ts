import express, { Request, Response } from "express";
import User from "../models/user";
import jwt from "jsonwebtoken";
import { check, validationResult } from "express-validator";
import verifyToken from "../middleware/auth";
import sendEmail from "./sendEmail";
import crypto from "crypto";

const router = express.Router();

router.get("/me", verifyToken, async (req: Request, res: Response) => {
  const userId = req.userId;

  try {
    const user = await User.findById(userId).select("-password");
    if (!user) {
      return res.status(400).json({ message: "User not found" });
    }
    res.json(user);
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "something went wrong" });
  }
});

router.post(
  "/register",
  [
    check("firstName", "First Name is required").isString(),
    check("lastName", "Last Name is required").isString(),
    check("email", "Email is required").isEmail(),
    check("password", "Password with 6 or more characters required").isLength({
      min: 6,
    }),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: errors.array() });
    }

    try {
      let user = await User.findOne({
        email: req.body.email,
      });

      if (user) {
        return res.status(400).json({ message: "User already exists" });
      }

      const otp = crypto.randomInt(100000, 999999).toString();

      user = new User({
        ...req.body,
        otp,
        otpExpiry: new Date(Date.now() + 10 * 60 * 1000), 
        isVerified: false
      });

      
      await user.save();

     
      
      await sendEmail({
        to: user.email,
        subject: "Verify your email",
        html: `
          <div style="font-family: Arial, sans-serif; background-color: #f2f2f2; padding: 30px;">
            <div style="max-width: 500px; margin: auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.05); overflow: hidden;">
              <div style="background-color: #4a4a4a; padding: 20px; text-align: center; color: #ffffff;">
                <h2 style="margin: 0;">Email Verification</h2>
              </div>
              <div style="padding: 25px;">
                <p style="color: #333;">Hi <strong>${user.firstName}</strong>,</p>
                <p style="color: #555;">Please use the following OTP to verify your email address:</p>
                <div style="margin: 20px auto; background-color: #f9f9f9; padding: 15px 20px; text-align: center; border-radius: 6px; font-size: 24px; font-weight: bold; color: #333; border: 1px solid #ddd;">
                  ${otp}
                </div>
                <p style="color: #888; margin-top: 20px;">This OTP is valid for <strong>10 minutes</strong>.</p>
              </div>
              <div style="background-color: #eeeeee; text-align: center; padding: 12px; color: #999;">
                <small>If you did not request this, please ignore this email.</small>
              </div>
            </div>
          </div>
        `,
      });
      console.log("email sent");

      
      const token = jwt.sign(
        { userId: user.id },
        process.env.JWT_SECRET_KEY as string,
        {
          expiresIn: "1d",
        }
      );

      // Set cookie
      res.cookie("auth_token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        maxAge: 86400000,
      });

      return res.status(200).send({ 
        message: "User registered successfully. Please verify your email.",
        user: user.email,
        userId: user.id
      });
    } catch (error) {
      console.log(error);
      res.status(500).send({ message: "Something went wrong" });
    }
  }
);

router.post("/verify-email", async (req: Request, res: Response) => {
  const { email, otp } = req.body;
  
  try {
    const user = await User.findOne({ email });

    if (!user) return res.status(400).json({ message: "User not found" });

    if (user.isVerified) {
      return res.status(400).json({ message: "Email already verified" });
    }

    if (!user.otp || !user.otpExpiry) {
      return res.status(400).json({ message: "OTP not generated for this user" });
    }

    if (user.otp !== otp) {
      return res.status(400).json({ message: "Invalid OTP" });
    }

    if (user.otpExpiry < new Date()) {
      return res.status(400).json({ message: "OTP expired" });
    }

    
    user.isVerified = true;
    user.otp = undefined;
    user.otpExpiry = undefined;
    await user.save();

    return res.status(200).json({ message: "Email verified successfully" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Something went wrong" });
  }
});

router.post("/resend-otp", async (req: Request, res: Response) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ message: "Email is required" });
  }

  try {
    const user = await User.findOne({ email });

    if (!user) return res.status(400).json({ message: "User not found" });

    if (user.isVerified) {
      return res.status(400).json({ message: "Email is already verified" });
    }

    // Generate new OTP
    const newOtp = crypto.randomInt(100000, 999999).toString();
    user.otp = newOtp;
    user.otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // valid for 10 minutes
    await user.save();

    // Resend the OTP email
    await sendEmail({
      to: user.email,
      subject: "Resend OTP - Verify your email",
      html: `
        <div style="font-family: Arial, sans-serif; background-color: #f2f2f2; padding: 30px;">
          <div style="max-width: 500px; margin: auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.05); overflow: hidden;">
            <div style="background-color: #4a4a4a; padding: 20px; text-align: center; color: #ffffff;">
              <h2 style="margin: 0;">Email Verification</h2>
            </div>
            <div style="padding: 25px;">
              <p style="color: #333;">Hi <strong>${user.firstName}</strong>,</p>
              <p style="color: #555;">Please use the following OTP to verify your email address:</p>
              <div style="margin: 20px auto; background-color: #f9f9f9; padding: 15px 20px; text-align: center; border-radius: 6px; font-size: 24px; font-weight: bold; color: #333; border: 1px solid #ddd;">
                ${newOtp}
              </div>
              <p style="color: #888; margin-top: 20px;">This OTP is valid for <strong>10 minutes</strong>.</p>
            </div>
            <div style="background-color: #eeeeee; text-align: center; padding: 12px; color: #999;">
              <small>If you did not request this, please ignore this email.</small>
            </div>
          </div>
        </div>
      `,
    });
    

    return res.status(200).json({ message: "OTP resent successfully" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Something went wrong" });
  }
});

export default router;