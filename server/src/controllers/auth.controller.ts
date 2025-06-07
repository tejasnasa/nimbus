import { sign } from "jsonwebtoken";
import { ServerResponse } from "../models/response.model";
import User from "../models/user.model";
import bcrypt from "bcryptjs";

export const signup = async (
  email: string,
  username: string,
  fullname: string,
  password: string
) => {
  try {
    const existingEmail = await User.findOne({ email });
    if (existingEmail) {
      return ServerResponse.failed("Email already exists");
    }

    const existingUsername = await User.findOne({ username });
    if (existingUsername) {
      return ServerResponse.failed("Username already exists");
    }

    const salt = await bcrypt.genSalt();
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = new User({
      fullname,
      username,
      email,
      password: hashedPassword,
    });

    await newUser.save();

    const token = sign(
      { userId: String(newUser._id) },
      process.env.JWT_SECRET,
      {
        expiresIn: "30d",
      }
    );

    return new ServerResponse(
      true,
      "User created",
      {
        userId: String(newUser._id),
        fullname: newUser.fullname,
        username: newUser.username,
        email: newUser.email,
        profilePic: newUser.profilePic,
      },
      201,
      token
    );
  } catch (error) {
    return ServerResponse.failed(error);
  }
};
