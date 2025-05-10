import express, { Request, Response } from "express";
import Hotel from "../models/hotel";
import { BookingType, HotelSearchResponse } from "../shared/types";
import { param, validationResult } from "express-validator";
import Stripe from "stripe";
import verifyToken from "../middleware/auth";
import sendEmail from "./sendEmail";

const stripe = new Stripe(process.env.STRIPE_API_KEY as string);

const router = express.Router();

router.get("/search", async (req: Request, res: Response) => {
  try {
    const query = constructSearchQuery(req.query);

    let sortOptions = {};
    switch (req.query.sortOption) {
      case "starRating":
        sortOptions = { starRating: -1 };
        break;
      case "pricePerNightAsc":
        sortOptions = { pricePerNight: 1 };
        break;
      case "pricePerNightDesc":
        sortOptions = { pricePerNight: -1 };
        break;
    }

    const pageSize = 5;
    const pageNumber = parseInt(
      req.query.page ? req.query.page.toString() : "1"
    );
    const skip = (pageNumber - 1) * pageSize;

    const hotels = await Hotel.find(query)
      .sort(sortOptions)
      .skip(skip)
      .limit(pageSize);

    const total = await Hotel.countDocuments(query);

    const response: HotelSearchResponse = {
      data: hotels,
      pagination: {
        total,
        page: pageNumber,
        pages: Math.ceil(total / pageSize),
      },
    };

    res.json(response);
  } catch (error) {
    console.log("error", error);
    res.status(500).json({ message: "Something went wrong" });
  }
});

router.get("/", async (req: Request, res: Response) => {
  try {
    const hotels = await Hotel.find().sort("-lastUpdated");
    res.json(hotels);
  } catch (error) {
    console.log("error", error);
    res.status(500).json({ message: "Error fetching hotels" });
  }
});

router.get(
  "/:id",
  [param("id").notEmpty().withMessage("Hotel ID is required")],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const id = req.params.id.toString();

    try {
      const hotel = await Hotel.findById(id);
      res.json(hotel);
    } catch (error) {
      console.log(error);
      res.status(500).json({ message: "Error fetching hotel" });
    }
  }
);

router.post(
  "/:hotelId/bookings/payment-intent",
  verifyToken,
  async (req: Request, res: Response) => {
    const { numberOfNights } = req.body;
    const hotelId = req.params.hotelId;

    const hotel = await Hotel.findById(hotelId);
    if (!hotel) {
      return res.status(400).json({ message: "Hotel not found" });
    }

    const totalCost = hotel.pricePerNight * numberOfNights;

    const paymentIntent = await stripe.paymentIntents.create({
      amount: totalCost * 100,
      currency: "gbp",
      metadata: {
        hotelId,
        userId: req.userId,
      },
    });

    if (!paymentIntent.client_secret) {
      return res.status(500).json({ message: "Error creating payment intent" });
    }

    const response = {
      paymentIntentId: paymentIntent.id,
      clientSecret: paymentIntent.client_secret.toString(),
      totalCost,
    };

    res.send(response);
  }
);

router.post(
  "/:hotelId/bookings",
  verifyToken,
  async (req: Request, res: Response) => {
    try {
      const paymentIntentId = req.body.paymentIntentId;

      const paymentIntent = await stripe.paymentIntents.retrieve(
        paymentIntentId as string
      );

      if (!paymentIntent) {
        return res.status(400).json({ message: "payment intent not found" });
      }

      if (
        paymentIntent.metadata.hotelId !== req.params.hotelId ||
        paymentIntent.metadata.userId !== req.userId
      ) {
        return res.status(400).json({ message: "payment intent mismatch" });
      }

      if (paymentIntent.status !== "succeeded") {
        return res.status(400).json({
          message: `payment intent not succeeded. Status: ${paymentIntent.status}`,
        });
      }

      const newBooking: BookingType = {
        ...req.body,
        userId: req.userId,
      };

      const hotel = await Hotel.findOneAndUpdate(
        { _id: req.params.hotelId },
        {
          $push: { bookings: newBooking },
        }
      );

      if (!hotel) {
        return res.status(400).json({ message: "hotel not found" });
      }

      await hotel.save();
      
      
      await sendEmail({
        to: req.body.email,
        subject: "Booking Confirmation",
        html: `
        <div style="font-family: Arial, sans-serif; background-color: #f7f7f7; padding: 30px;">
          <div style="max-width: 600px; margin: auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
            <div style="background-color: #4a4a4a; padding: 20px; text-align: center; color: #ffffff;">
              <h1 style="margin: 0;">HoliStay.com</h1>
              <p style="margin: 5px 0 0;">Booking Confirmation</p>
            </div>
            <div style="padding: 30px;">
              <h2 style="color: #333;">Hi ${req.body.firstName},</h2>
              <p style="color: #555;">We're excited to confirm your hotel booking!</p>
              <div style="margin: 20px 0; background-color: #f1f1f1; padding: 20px; border-radius: 6px;">
                <p style="margin: 0;"><strong>Hotel:</strong> ${hotel.name}</p>
                <p style="margin: 0;"><strong>Hotel ID:</strong> ${req.params.hotelId}</p>
                <p style="margin: 0;"><strong>Check-In:</strong> ${new Date(req.body.checkIn).toDateString()}</p>
                <p style="margin: 0;"><strong>Check-Out:</strong> ${new Date(req.body.checkOut).toDateString()}</p>
                <p style="margin: 0;"><strong>Total Cost:</strong> ₹${parseFloat(req.body.totalCost).toFixed(2)}</p>
              </div>
              <p style="color: #555;">Thank you for choosing HoliStay. We wish you a wonderful stay!</p>
            </div>
            <div style="background-color: #eeeeee; text-align: center; padding: 15px; color: #999;">
              <small>Need help? Contact us at support@holistay.com</small>
            </div>
          </div>
        </div>
        `,
      });
      
      res.status(200).send();
    } catch (error) {
      console.log(error);
      res.status(500).json({ message: "something went wrong" });
    }
  }
);

const constructSearchQuery = (queryParams: any) => {
  let constructedQuery: any = {};

  if (queryParams.destination) {
    constructedQuery.$or = [
      { city: new RegExp(queryParams.destination, "i") },
      { country: new RegExp(queryParams.destination, "i") },
    ];
  }

  if (queryParams.adultCount) {
    constructedQuery.adultCount = {
      $gte: parseInt(queryParams.adultCount),
    };
  }

  if (queryParams.childCount) {
    constructedQuery.childCount = {
      $gte: parseInt(queryParams.childCount),
    };
  }

  if (queryParams.facilities) {
    constructedQuery.facilities = {
      $all: Array.isArray(queryParams.facilities)
        ? queryParams.facilities
        : [queryParams.facilities],
    };
  }

  if (queryParams.types) {
    constructedQuery.type = {
      $in: Array.isArray(queryParams.types)
        ? queryParams.types
        : [queryParams.types],
    };
  }

  if (queryParams.stars) {
    const starRatings = Array.isArray(queryParams.stars)
      ? queryParams.stars.map((star: string) => parseInt(star))
      : parseInt(queryParams.stars);

    constructedQuery.starRating = { $in: starRatings };
  }

  if (queryParams.maxPrice) {
    constructedQuery.pricePerNight = {
      $lte: parseInt(queryParams.maxPrice).toString(),
    };
  }

  return constructedQuery;
};

// router.post('/',verifyToken, async (req: Request, res: Response) => {
//   try {
//     const {
//       firstName,
//       lastName,
//       email,
//       adultCount,
//       childCount,
//       checkIn,
//       checkOut,
//       hotelId,
//       paymentIntentId,
//       totalCost,
//     } = req.body;

//     // Save booking to database
//     const booking = await Hotel.create({
//       firstName,
//       lastName,
//       email,
//       adultCount,
//       childCount,
//       checkIn,
//       checkOut,
//       hotelId,
//       paymentIntentId,
//       totalCost,
//     });

  
//    await sendEmail({
      
//       to: email,
//       subject: "Booking Confirmation",
//       html: `
//         <h2>Hi ${firstName},</h2>
//         <p>Your booking has been confirmed.</p>
//         <ul>
//           <li>Hotel ID: ${hotelId}</li>
//           <li>Check-In: ${new Date(checkIn).toDateString()}</li>
//           <li>Check-Out: ${new Date(checkOut).toDateString()}</li>
//           <li>Total Cost: ₹${totalCost.toFixed(2)}</li>
//         </ul>
//         <p>Thank you for booking with us!</p>
//       `,
//     });

    

//     res.status(201).json({ message: "Booking created and email sent", booking });
//   } catch (err) {
//     console.error("Booking failed", err);
//     res.status(500).json({ message: "Internal server error" });
//   }
// });

export default router;
