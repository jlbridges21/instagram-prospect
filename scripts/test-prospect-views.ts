import { prospectReason, relationshipLabel, showProfilePhoto } from "../lib/prospects/reason";
import { prospectMatchesView } from "../lib/prospects/views";

const failures: string[] = [];
function check(name: string, condition: boolean) {
  if (!condition) failures.push(name);
  else console.log(`ok ${name}`);
}

const followed = { status: "disqualified", already_following: true, fit_label: null };
check("followed account is excluded", prospectMatchesView("excluded", followed));
check("followed account is not active", prospectMatchesView("active", followed) === false);
check("followed account is not review", prospectMatchesView("review", followed) === false);
check("disqualified skip fit is excluded", prospectMatchesView("excluded", { status: "disqualified", already_following: false, fit_label: "skip" }));
check("review prospect is not excluded", prospectMatchesView("excluded", { status: "review", already_following: false, fit_label: "strong_fit" }) === false);
check("review prospect is not only in excluded", prospectMatchesView("review", { status: "review", already_following: false, fit_label: "strong_fit" }));

check(
  "stored reason wins",
  prospectReason({ qualification_reason: "Port authority organization, not a media service provider.", already_following: true }) ===
    "Port authority organization, not a media service provider.",
);
check(
  "already following fallback",
  prospectReason({ already_following: true, qualification_reason: null }) === "Already following this account.",
);
check(
  "analysis error fallback",
  prospectReason({ qualification_error: "timeout", ai_analyzed_at: null }) === "AI analysis failed. Retry available.",
);
check("awaiting analysis", prospectReason({ status: "discovered" }) === "Awaiting analysis");
check("following relationship", relationshipLabel({ already_following: true }) === "Following");
check("unknown relationship", relationshipLabel({ qualification_reason: "Follow status unknown." }) === "Unknown");
check("photo renders when the url is present", showProfilePhoto("https://cdninstagram.com/a.jpg", false));
check("photo error uses the fallback", showProfilePhoto("https://cdninstagram.com/a.jpg", true) === false);
check("missing photo uses the fallback", showProfilePhoto(null, false) === false);

if (failures.length > 0) {
  console.error(failures.map((name) => `FAIL ${name}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log("prospect view checks passed");
}
