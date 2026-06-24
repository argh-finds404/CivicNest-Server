const { getCollection } = require('../config/db');

const POINTS_MAP = {
  // Issues
  issue_reported:        10,    // member posts an issue
  issue_claimed:          5,    // member claims an issue to resolve
  issue_solved:          50,    // resolver's issue gets 3 verifications
  issue_reporter_bonus:  25,    // reporter gets this when their issue is solved
  issue_verified:         5,    // community member verifies a resolution
  issue_verified_onsite: 7,    // verifier was GPS-near the site (+2 bonus)

  // Events
  event_attended:        30,    // check-in at cleanup drive verified
  event_organized:       50,    // organizer when event marked complete

  // Community
  contribution_made:     15,    // financial contribution to any fund
  witness_added:          5,    // adds witness report to an issue
  drive_created:          5,    // immediate on creating a drive
  streak_milestone:      25,    // streak milestone bonus

  // One-time
  first_issue:           20,    // bonus on first ever issue posted
  first_event:           20,    // bonus on first event attended
  membership_approved:   25,    // when membership is approved
  volunteer_registered:  10,    // on volunteer registration

  // Animals
  animal_rescued_reporter:  50,
  animal_rescued_volunteer: 30,

  // Lost & Found
  lostfound_action_taken: 5,    // finder reports found / owner claims
  lostfound_reunited:     20,   // both parties on resolution
};

const VOLUNTEER_MULTIPLIER_EVENTS = new Set([
  'issue_reported',
  'issue_claimed',
  'issue_solved',
  'issue_verified',
  'issue_verified_onsite',
  'event_attended',
  'contribution_made',
  'witness_added',
  'animal_rescued_volunteer',
]);

async function addPoints(email, eventKey, options = {}) {
  if (!email || !POINTS_MAP[eventKey]) return 0;

  const usersCollection = getCollection('users');
  const base = POINTS_MAP[eventKey];

  // Fetch user — we need isVolunteer flag and role
  const user = await usersCollection.findOne(
    { email },
    { projection: { isVolunteer: 1, points: 1, badges: 1, role: 1 } }
  );
  if (!user) return 0;

  // Apply multiplier only to qualifying events
  const isVolunteer  = !!user.isVolunteer;
  const isMember     = user.role === 'member' || user.role === 'admin';
  
  let multiplier = 1;
  if (isVolunteer && VOLUNTEER_MULTIPLIER_EVENTS.has(eventKey)) {
    multiplier = 2;
  }
  // Double points for volunteer registration if they are already a member
  if (eventKey === 'volunteer_registered' && isMember) {
    multiplier = 2;
  }
  const toAdd        = base * multiplier;

  // Single atomic update
  const updated = await usersCollection.findOneAndUpdate(
    { email },
    { $inc: { points: toAdd } },
    { returnDocument: 'after', projection: { points: 1, badges: 1 } }
  );

  const newTotal = updated.value?.points !== undefined 
    ? updated.value.points 
    : (updated.points !== undefined ? updated.points : (user.points || 0) + toAdd);
    
  const currentBadges = updated.value?.badges || updated.badges || user.badges || [];

  // Check badge unlocks
  await checkBadges(usersCollection, email, newTotal, currentBadges);

  // Notify user about points earned
  if (toAdd > 0) {
    try {
      const { createNotification } = require('./notificationHelper');
      const EVENT_DESCRIPTIONS = {
        issue_reported:        "reporting an issue",
        issue_claimed:          "claiming an issue to resolve",
        issue_solved:          "successfully resolving an issue",
        issue_reporter_bonus:  "your reported issue being resolved",
        issue_verified:         "verifying an issue resolution",
        issue_verified_onsite:  "verifying an issue resolution on-site",
        event_attended:        "attending a cleanup event",
        event_organized:       "organizing a completed cleanup event",
        contribution_made:     "making a financial contribution",
        witness_added:          "adding a witness report to an issue",
        drive_created:          "creating a cleanup drive",
        first_issue:           "posting your first issue (first issue bonus)",
        first_event:           "attending your first event (first event bonus)",
        membership_approved:   "your membership approval",
        volunteer_registered:  "registering as a volunteer",
        animal_rescued_reporter: "successfully rescuing an animal",
        animal_rescued_volunteer: "assisting in an animal rescue",
        lostfound_action_taken: "taking action on a lost & found item",
        lostfound_reunited:     "reuniting a lost/found item",
        streak_milestone:       "reaching a civic streak milestone",
      };
      
      const reason = EVENT_DESCRIPTIONS[eventKey] || eventKey.replace(/_/g, ' ');
      const multiplierText = (multiplier > 1) ? ` (Volunteer Multiplier x${multiplier})` : '';
      let msg = `🎉 You earned +${toAdd} points for ${reason}!${multiplierText}`;

      if (eventKey === 'membership_approved') {
        msg = `🎉 Welcome to CivicNest! You've earned a +${toAdd} points member welcome bonus!`;
      } else if (eventKey === 'volunteer_registered') {
        msg = `🎉 Welcome! You are now a registered volunteer and earned a +${toAdd} points bonus!`;
      }
      
      await createNotification({
        userId:   email,
        email:    email,
        message:  msg,
        type:     'points',
        link:     '/profile',
        priority: 'normal',
      });
    } catch (notifErr) {
      console.error("Failed to send points notification:", notifErr);
    }
  }

  return toAdd;
}

const BADGE_RULES = [
  { id: 'first_reporter',    label: 'First Reporter',       pointsNeeded: null, event: 'issue_reported', oneTime: true },
  { id: 'resolver',          label: 'Resolver',             pointsNeeded: null, event: 'issue_solved',   oneTime: true },
  { id: 'cleanup_crew',      label: 'Cleanup Crew',         pointsNeeded: null, eventsNeeded: 3 },
  { id: 'verified_volunteer',label: 'Verified Volunteer',   pointsNeeded: null, event: 'volunteer_registered', oneTime: true },
  { id: 'civic_hero',        label: 'Civic Hero',           pointsNeeded: 500 },
  { id: 'guardian',          label: 'Community Guardian',   pointsNeeded: 1000 },
  { id: 'champion',          label: 'Champion',             pointsNeeded: 2500 },
];

async function checkBadges(usersCollection, email, totalPoints, existingBadges) {
  const toUnlock = [];

  for (const rule of BADGE_RULES) {
    if (existingBadges.includes(rule.id)) continue;
    if (rule.pointsNeeded && totalPoints >= rule.pointsNeeded) {
      toUnlock.push(rule.id);
    }
  }

  if (toUnlock.length > 0) {
    await usersCollection.updateOne(
      { email },
      { $addToSet: { badges: { $each: toUnlock } } }
    );

    // Notify user about each badge
    const { createNotification } = require('./notificationHelper');
    await Promise.all(toUnlock.map(badge =>
      createNotification({
        userId:   email,
        email:    email,
        message:  `🏅 You unlocked the "${BADGE_RULES.find(r => r.id === badge)?.label}" badge!`,
        type:     'badge',
        link:     '/profile',
        priority: 'high',
      })
    ));
  }
}

module.exports = { addPoints, POINTS_MAP };
