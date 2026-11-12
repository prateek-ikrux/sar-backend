import mongoose from "mongoose";

// Search results stringify profile ids, so a saved id is matched in both
// forms: as an ObjectId (what the ATS stores in practice) and as given.
const idForms = (id) =>
    /^[0-9a-f]{24}$/i.test(id) ? [new mongoose.Types.ObjectId(id), id] : [id];

export { idForms };
