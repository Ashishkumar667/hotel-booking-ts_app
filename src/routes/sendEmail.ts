import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

const transporter = nodemailer.createTransport({
  service: "gmail", 
  auth: {
    user: process.env.EMAIL_FROM,        
    pass: process.env.EMAIL_PASSWORD,    
  },
});

const sendEmail = async ({
  to,
  subject,
  html,
}: {
  to: string;
  subject: string;
  html: string;
}) => {
  const mailOptions = {
    from: process.env.EMAIL_FROM, 
    to,
    subject,
    html,
  };

  const info = await transporter.sendMail(mailOptions);
  console.log("Email sent:", info.response);
};

export default sendEmail;
