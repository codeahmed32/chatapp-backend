import mongoose from "mongoose";
const messageSchema = new mongoose.Schema({
    senderName:{
        type:String,
        required:true
    },
    message:{
        type:String,
        required:true,

    },
    timeStamp:{
        type:Date,
        default:Date.now,
    },
});

const roomSchema = new mongoose.Schema({
    roomId:{
        type:String,
        required:true,
        unique: true,
    },
    messages:[messageSchema],

});
module.exports = mongoose.model("Room", roomSchema);