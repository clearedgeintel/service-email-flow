# ClearDesk Test Emails

Copy-paste these into your monitored inbox to exercise the full classification, auto-reply, and routing pipeline. Each email targets a specific intent/urgency/trade combination.

Send each one **from a different external email address** (or use Gmail's `+` alias trick: `youremail+test1@gmail.com`, `youremail+test2@gmail.com`, etc.) so they create separate cases rather than threading.

---

## 1. EMERGENCY — Plumbing (flooding)

**Subject:** URGENT — water everywhere

**Body:**
```
Hi, I need help immediately. A pipe burst under my kitchen sink about 20 minutes ago and water is flooding the floor. I've turned off the main valve but there's already standing water in the kitchen and it's seeping into the hallway.

Please send someone ASAP.

Mike Reynolds
(817) 555-0101
4210 Cedar Springs Rd, Fort Worth TX 76109
```

**Expected:** intent=EMERGENCY, urgency=EMERGENCY, trade=plumbing, sentiment=concerned/frustrated

---

## 2. EMERGENCY — Electrical (sparking panel)

**Subject:** Electrical panel sparking — need help now

**Body:**
```
Our breaker panel started sparking and making a buzzing sound this morning. I shut off the main breaker but I'm afraid to turn anything back on. There's a slight burning smell.

We have two small kids in the house. Can someone come out today?

Sarah Chen
817-555-0202
1800 W 7th St, Fort Worth TX 76102
```

**Expected:** intent=EMERGENCY, urgency=EMERGENCY, trade=electric, sentiment=concerned

---

## 3. REPAIR_REQUEST — Plumbing, same-day

**Subject:** Hot water heater not working

**Body:**
```
Good morning,

Our hot water heater stopped producing hot water sometime last night. We have no hot water for showers or dishes. It's a 50-gallon gas unit, about 8 years old. The pilot light appears to be out and I can't get it to relight.

Would love to get this fixed today if possible.

Thanks,
David Park
(817) 555-0303
2901 Race St, Fort Worth TX
Available anytime today after 10am
```

**Expected:** intent=REPAIR_REQUEST, urgency=TODAY, trade=plumbing, sentiment=neutral

---

## 4. REPAIR_REQUEST — Electrical, this week

**Subject:** Outlets not working in bedroom

**Body:**
```
Hi there,

About half the outlets in our master bedroom stopped working. The breaker doesn't appear to be tripped. The rest of the house is fine. No sparking or burning smell — just dead outlets.

Not super urgent but would like to get it looked at this week if you have availability.

Best,
Jennifer Walsh
jennifer.walsh@email.com
(817) 555-0404
```

**Expected:** intent=REPAIR_REQUEST, urgency=THIS_WEEK, trade=electric, sentiment=neutral

---

## 5. REPAIR_REQUEST — Both trades

**Subject:** Bathroom remodel needs electric and plumbing

**Body:**
```
We're doing a bathroom remodel and need both electrical and plumbing work:
- Move the toilet drain about 18 inches to the left
- Add a new vanity with double sinks
- Install 3 new recessed lights
- Add a GFCI outlet near the new vanity
- Move the shower valve to accommodate a larger shower

The remodel isn't starting for another 2 weeks, so no rush. Just need a quote.

Tom & Lisa Nguyen
817-555-0505
7300 Camp Bowie Blvd, Fort Worth TX
```

**Expected:** intent=SALES_INQUIRY, urgency=ROUTINE, trade=both, sentiment=neutral/positive

---

## 6. SALES_INQUIRY — New construction estimate

**Subject:** Quote for new home wiring

**Body:**
```
Hello,

I'm building a new home in the Alliance area (lot is on Blue Mound Rd near 35W) and need a quote for complete electrical wiring. It's a 4-bedroom, 3-bath, approximately 2,800 sq ft.

Plans are available — happy to email them over or meet on site.

Thanks,
Robert Kim
robert.kim@newbuild.com
(682) 555-0606
```

**Expected:** intent=SALES_INQUIRY, urgency=ROUTINE, trade=electric, sentiment=positive

---

## 7. BILLING — Invoice question

**Subject:** Question about invoice #4872

**Body:**
```
Hi,

I received invoice #4872 for $385 but I thought the quote was $325. Can someone explain the difference? Was there additional work done that I wasn't aware of?

Also, do you accept payment plans? This is a bit more than I budgeted for.

Thanks,
Maria Gonzalez
(817) 555-0707
```

**Expected:** intent=BILLING, urgency=ROUTINE, trade=unknown, sentiment=concerned

---

## 8. GENERAL_QUESTION — Service area

**Subject:** Do you service Weatherford?

**Body:**
```
Hi, just wondering if you guys come out to Weatherford? We're on the west side of town near the college. Need some electrical work done eventually but wanted to check your service area first.

Thanks!
Chris
```

**Expected:** intent=GENERAL_QUESTION, urgency=ROUTINE, trade=electric, sentiment=neutral

---

## 9. JOB_APPLICANT — Electrician

**Subject:** Journeyman electrician looking for work

**Body:**
```
Good afternoon,

My name is James Rodriguez and I'm a licensed journeyman electrician with 6 years of experience in residential and light commercial. I recently relocated to the DFW area from Houston.

I have my own tools and a clean driving record. I hold a current Texas electrical journeyman license (TDL #JE-28104).

I've attached my resume. Would love to chat about any open positions.

Best regards,
James Rodriguez
(832) 555-0808
james.r.electrician@gmail.com
```

**Expected:** intent=JOB_APPLICANT, urgency=ROUTINE, trade=electric, sentiment=positive

---

## 10. VENDOR — Supply company pitch

**Subject:** Wholesale electrical supplies — new customer discount

**Body:**
```
Hi there,

I'm Mark from SunCoast Electrical Supply. We're expanding into the DFW market and offering 15% off first orders for new contractor accounts.

We carry Eaton, Square D, Leviton, and Lutron. Same-day delivery on most items within the metroplex.

Would love to set up a quick call to discuss. My number is (214) 555-0909.

Mark Thompson
Account Manager, SunCoast Electrical Supply
mark@suncoastsupply.com
```

**Expected:** intent=VENDOR, urgency=ROUTINE, trade=electric, sentiment=positive

---

## 11. SPAM — Marketing blast

**Subject:** Grow Your Business 10X with Our AI CRM!!!

**Body:**
```
Dear Business Owner,

Are you tired of losing leads? Our revolutionary AI-powered CRM has helped 10,000+ contractors increase revenue by 300%!!!

Click here for a FREE demo: [link]
Limited time offer — only $99/month (normally $499)!

Don't miss out!!!

Unsubscribe: [link]
```

**Expected:** intent=SPAM, urgency=ROUTINE, trade=unknown, sentiment=neutral

---

## 12. REPAIR_REQUEST — Frustrated customer, plumbing

**Subject:** Re: Still waiting on repair

**Body:**
```
This is the third time I'm reaching out. I called last week and was told someone would come Tuesday. Nobody showed up. I called again Wednesday and was promised Friday. Again, no-show.

My kitchen faucet is still leaking badly and now there's water damage on the cabinet underneath. This is completely unacceptable.

I need someone here TODAY or I'm calling another company and disputing the diagnostic fee I already paid.

Angela Torres
817-555-1212
3650 S University Dr, Fort Worth TX 76109
```

**Expected:** intent=REPAIR_REQUEST, urgency=TODAY, trade=plumbing, sentiment=frustrated, sentiment_score close to -1.0

---

## 13. REPAIR_REQUEST — Grateful / positive customer

**Subject:** Need another repair — you guys are great

**Body:**
```
Hey team!

You fixed our hot water heater last month and did an amazing job. Now we've got a slow drain in the upstairs bathroom. Not urgent at all — whenever you have an opening is fine.

Your tech Mike was awesome by the way. Would love to have him come back if he's available.

Thanks so much,
Patricia Hall
(817) 555-1313
```

**Expected:** intent=REPAIR_REQUEST, urgency=ROUTINE, trade=plumbing, sentiment=grateful, sentiment_score close to 1.0

---

## 14. Vague / minimal info (edge case)

**Subject:** help

**Body:**
```
my toilet is broken can someone fix it
```

**Expected:** intent=REPAIR_REQUEST, urgency=ROUTINE, trade=plumbing. No phone/address/name extracted. Tests classifier handling of sparse input.

---

## 15. Multi-issue email (edge case)

**Subject:** Several things need fixing

**Body:**
```
Hi,

We just moved into an older home and have a laundry list:

1. The garbage disposal is jammed and making a humming noise
2. Two outlets in the garage are dead
3. The outdoor spigot is dripping constantly
4. We need a ceiling fan installed in the living room
5. The guest bathroom toilet runs continuously

We're pretty flexible on timing. Maybe you could send someone out to assess everything at once?

Kevin & Amy Foster
817-555-1515
1204 W Magnolia Ave, Fort Worth TX 76104
```

**Expected:** intent=REPAIR_REQUEST, urgency=ROUTINE, trade=both. Tests extraction of multiple issues into a single problem_summary.

---

## Tips

- **Wait 2 minutes** between sending and checking the dashboard — the Gmail poller runs every 2 minutes.
- **Check the Activity feed** on each case to verify the full pipeline ran: RECEIVED → CLASSIFIED → auto-reply (if enabled) → ROUTED.
- **Test SMS**: after a case is created with a phone number, try texting that Twilio number from the same phone. The inbound SMS should link to the existing case.
- **Test voice**: call your Retell number from the same phone number used in test #3. The call should link to David Park's case.
- **Test channel filter**: after ingesting a few emails + an SMS + a call, use the channel filter chips on the dashboard to confirm each channel shows the right cases.
- **Test unified search**: search for "garbage disposal" — should find case #15 whether the text came in via email, SMS, or was mentioned in a call transcript.
