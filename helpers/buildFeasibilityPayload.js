const axios = require("axios");

async function resolveCoords(locationData) {
  const { latitude, longitude, shippingAddress } = locationData;

  if (latitude && longitude) {
    return { lat: latitude, lng: longitude, coordsType: "Sales" };
  }

  const { address1, address2, city, state, pincode } = shippingAddress;
  const fullAddress = [address1, address2, city, state, pincode].filter(Boolean).join(", ");

  try {
    const geoRes = await axios.get("https://maps.googleapis.com/maps/api/geocode/json", {
      params: {
        key: process.env.GOOGLE_MAPS_API_KEY || "AIzaSyAFyFZgmgNqkw6PFrjEbXFwb5K0Gvux_yE",
        address: fullAddress,
      },
    });

    const result = geoRes.data?.results?.[0]?.geometry?.location;
    if (result) {
      return { lat: String(result.lat), lng: String(result.lng), coordsType: "Geo" };
    }
  } catch (err) {
    console.error("Google Geocoding API failed:", err.message);
  }

  return { lat: "", lng: "", coordsType: "Geo" };
}

function resolveInterfaceType(reqBandwidth, reqBandwidthUOM) {
  let bwMbps = parseFloat(reqBandwidth);
  if (reqBandwidthUOM?.toLowerCase() === "gbps") bwMbps *= 1000;
  if (reqBandwidthUOM?.toLowerCase() === "kbps") bwMbps /= 1000;
  return bwMbps >= 500 ? "Optical - Single Mode" : "Electrical Ethernet";
}

function resolveLmType(connectionType) {
  const type = connectionType?.toLowerCase()?.trim();
  if (type === "wireless") return "Sify Wireless";
  return "Sify Fiber";
}

function resolveRequestType(quoteType) {
  if (!quoteType || quoteType === "New") return "New";
  return "Modify";
}

async function buildFeasibilityPayload(reqId, product) {
  const collectionMap = {
    DIA: "quoteills",
    MPLS: "qoutempls",
    P2P: "quotep2ps",
  };
  const collectionName = collectionMap[product?.toUpperCase()] || "quoteills";

  const quote = await db.collection(collectionName).findOne({ reqId: parseInt(reqId), isActive: true });
  if (!quote) throw new Error(`Quote not found for reqId: ${reqId}`);

  const {
    quoteType,
    locationDetails,
    companyName,
    ebsAccountNo,
  } = quote;

  const company = await loginDB.collection("companies").findOne({ ebsaccountNo: ebsAccountNo });
  const accountManagerName = company?.accountManager_name || "";
  const accountManagerPhone = company?.cpMobile || "";

  const feasIdDoc = await db.collection("reqIds").findOneAndUpdate(
    { id: "feasibility_id" },
    { $inc: { reqId: locationDetails.length } },
    { returnDocument: "before", upsert: true }
  );
  let feasibilityIdCounter = feasIdDoc?.reqId || 100000;

  const payloads = [];

  for (const loc of locationDetails) {
    const {
      reqBandwidth,
      reqBandwidthUOM,
      connectionType,
      contactDetails,
      shippingAddress,
      existingPlanDetails,
    } = loc;

    const { lat, lng, coordsType } = await resolveCoords(loc);

    const contactName = `${contactDetails?.contactFirstName || ""} ${contactDetails?.contactLastName || ""}`.trim();

    payloads.push({
      requestType: resolveRequestType(quoteType),
      bandwidth: reqBandwidth,
      bandwidthUnits: "MBPS",
      linkId: existingPlanDetails?.linkId || "",
      linkConfig: "Single Line",
      linkType: "Primary",
      lmType: resolveLmType(connectionType),
      serviceType: product,
      feasibilityId: String(feasibilityIdCounter++),
      associateFeasibilityId: "",
      coordsType,
      latitude: lat,
      longitude: lng,
      buildingType: "Custom Location",
      buildingId: "",
      buildingHeight: "",
      buildingName: "",
      address1: shippingAddress?.address1 || "",
      address2: shippingAddress?.address2 || "",
      city: shippingAddress?.city || "",
      state: shippingAddress?.state || "",
      pincode: shippingAddress?.pincode || "",
      customerName: companyName || "",
      customerId: ebsAccountNo || "",
      customerType: "Regular",
      portBw: "0.1Gbps",
      portType: "1G",
      bwType: "Fixed",
      burstOption: "",
      interfaceType: resolveInterfaceType(reqBandwidth, reqBandwidthUOM),
      providers: [],
      contactName,
      contactEmail: contactDetails?.contactEmail || "",
      contactPhone: String(contactDetails?.contactPhoneNumber1 || ""),
      remarks: "",
      ...(connectionType?.toLowerCase() === "wireless" && { buildingTerrace: "Concrete" }),
      requestedBy: accountManagerName,
      requestedContactNumber: accountManagerPhone,
      resubmittedDate: "",
      hasStaticIP: "",
    });
  }

  return payloads;
}

module.exports = { buildFeasibilityPayload };
