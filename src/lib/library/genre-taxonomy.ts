// ═══════════════════════════════════════════════════════════════
//  genre-taxonomy — subjects in, one bookstore shelf out.
//
//  Embedded EPUB dc:subject values and OpenLibrary subjects are noisy
//  free text ("Computers — Networking — General", "TCP/IP (Computer
//  network protocol)", "Fiction, science fiction, general"). This
//  module normalizes that noise into a FIXED, bookstore-style shelf
//  list so the library organizes itself on import the way a store
//  would shelve it — one genre per book, editable afterwards.
//
//  Matching is ordered, specific → general, first hit wins: a book
//  tagged both "science fiction" and "fiction" shelves as Science
//  Fiction & Fantasy, and "computer security" wins over the generic
//  "computers" bucket. Patterns match against every subject string,
//  lowercased. No title/filename guessing — a book with no usable
//  subjects returns null and shelves as Unsorted, which is the honest
//  manual pile.
//
//  The shelf list leans technical (this library's center of gravity)
//  with general-bookstore coverage behind it. Editing the taxonomy is
//  expected: add a rule, rescan, done — assignment only ever fills
//  books that have no genre yet, so re-runs never clobber curation.
// ═══════════════════════════════════════════════════════════════

export const UNSORTED = "Unsorted";

interface Rule {
  genre: string;
  patterns: RegExp[];
}

// Order is load-bearing: specific shelves before general ones.
const RULES: Rule[] = [
  // ── Technical, specific ─────────────────────────────────────
  {
    genre: "Security & Privacy",
    patterns: [
      /securit/, /privacy/, /cryptograph/, /encryption/, /hacking/, /hacker/,
      /penetration test/, /pentest/, /malware/, /forensic/, /exploit/,
      /threat/, /vulnerab/, /infosec/, /opsec/, /surveillance/,
    ],
  },
  {
    genre: "Networking & Sysadmin",
    patterns: [
      // NOTE: no bare /server/ — "Windows Server" and "SQL Server" must
      // shelve with their own subjects, not here.
      /network/, /tcp\/?ip/, /dns\b/, /routing/, /cisco/, /ccna/, /sysadmin/,
      /system administr/, /web servers?/, /\bvpn\b/, /firewall/, /wireshark/,
      /protocols?\b/, /wireless/, /voip/,
    ],
  },
  {
    genre: "Cloud & DevOps",
    patterns: [
      /cloud/, /devops/, /docker/, /kubernetes/, /container/, /terraform/,
      /ansible/, /aws\b/, /azure/, /google cloud/, /site reliability/,
      /\bsre\b/, /ci\/cd/, /infrastructure as code/, /virtualization/,
    ],
  },
  {
    genre: "AI & Machine Learning",
    patterns: [
      /machine learning/, /deep learning/, /neural network/,
      /artificial intelligence/, /\bai\b/, /natural language processing/,
      /computer vision/, /reinforcement learning/, /\bllms?\b/,
      /generative/, /data mining/,
    ],
  },
  {
    genre: "Data & Databases",
    patterns: [
      /database/, /\bsql\b/, /postgres/, /mysql/, /sqlite/, /mongodb/,
      /data warehous/, /data engineering/, /data scien/, /analytics/,
      /big data/, /statistics.*comput/, /\betl\b/, /data analysis/,
    ],
  },
  {
    genre: "Web Development",
    patterns: [
      /web develop/, /javascript/, /typescript/, /\bcss\b/, /\bhtml\b/,
      /react/, /node\.?js/, /front[- ]?end/, /back[- ]?end/, /full[- ]?stack/,
      /\bapis?\b/, /web application/, /web design/, /http\b/,
    ],
  },
  {
    genre: "Programming",
    patterns: [
      /programming/, /software develop/, /computer languages?/, /\bpython\b/,
      /\bjava\b/, /\bc\+\+/, /\brust\b/, /\bgolang\b|\bgo\b.*language/,
      /kotlin/, /swift\b/, /compilers?/, /algorithms?/, /data structures?/,
      /functional programming/, /coding/,
    ],
  },
  {
    genre: "Software Engineering",
    patterns: [
      /software engineer/, /software architec/, /design patterns?/,
      /refactoring/, /agile/, /scrum/, /software test/, /clean code/,
      /software project/, /software craft/, /systems? design/,
    ],
  },
  {
    genre: "Operating Systems",
    patterns: [
      /operating systems?/, /\blinux\b/, /\bunix\b/, /windows (server|internals|administr)/,
      /\bbsd\b/, /kernel/, /command line/, /shell script/, /bash\b/,
      /powershell/, /macos/, /android.*(internals|develop)/,
    ],
  },
  {
    genre: "Hardware & Electronics",
    patterns: [
      /electronics?/, /hardware/, /arduino/, /raspberry pi/, /microcontroller/,
      /embedded/, /circuits?/, /robotics/, /3d print/, /soldering/,
      /computer engineering/, /fpga/,
    ],
  },
  {
    genre: "Computers & Technology",
    patterns: [
      /computers?\b/, /computer science/, /information technology/,
      /informatics/, /internet/, /digital/, /technology/,
    ],
  },

  // ── STEM, general ───────────────────────────────────────────
  {
    genre: "Mathematics",
    patterns: [
      /mathematic/, /\balgebra\b/, /calculus/, /geometry/, /number theory/,
      /statistics/, /probabilit/, /logic\b/, /discrete math/,
    ],
  },
  {
    genre: "Science",
    patterns: [
      /physics/, /chemistry/, /biology/, /astronomy/, /astrophysics/,
      /geology/, /neuroscience/, /genetics/, /evolution/, /quantum/,
      // Bare "science" must not steal "science fiction" (a fiction shelf
      // below) or "social/computer science" (shelved by their own rules).
      /(?<!social )(?<!computer )\bscience\b(?! fiction)/, /ecology/, /climate/,
    ],
  },
  {
    genre: "Engineering",
    patterns: [
      /engineering/, /mechanical/, /electrical engineer/, /civil engineer/,
      /aerospace/, /manufacturing/,
    ],
  },
  {
    genre: "Health & Fitness",
    patterns: [
      /health/, /fitness/, /nutrition/, /medicine/, /medical/, /anatomy/,
      /exercise/, /yoga/, /diet\b/, /mental health/, /first aid/,
    ],
  },

  // ── Practical & lifestyle ───────────────────────────────────
  {
    genre: "Cooking & Food",
    patterns: [/cooking/, /cookbook/, /cookery/, /baking/, /recipes?/, /food\b/, /culinary/],
  },
  {
    genre: "Home & DIY",
    patterns: [
      /do[- ]it[- ]yourself/, /\bdiy\b/, /home improvement/, /woodworking/,
      /gardening/, /homestead/, /carpentry/, /repair/,
    ],
  },
  {
    genre: "Outdoors & Survival",
    patterns: [
      /survival/, /wilderness/, /camping/, /hiking/, /bushcraft/, /prepping/,
      /emergency preparedness/, /foraging/, /navigation\b/,
    ],
  },
  {
    genre: "Travel",
    patterns: [/travel/, /guidebook/, /voyages?/],
  },

  // ── Business & society ──────────────────────────────────────
  {
    genre: "Business & Finance",
    patterns: [
      /business/, /finance/, /investing/, /economics/, /entrepreneur/,
      /management/, /marketing/, /accounting/, /money\b/, /startups?/,
    ],
  },
  {
    genre: "Politics & Society",
    patterns: [
      /politic/, /sociology/, /social science/, /current events/,
      /journalism/, /activism/, /government/, /law\b/, /legal\b/,
      /anthropology/, /culture\b/,
    ],
  },
  {
    genre: "Self-Improvement",
    patterns: [
      /self[- ]help/, /self[- ]improvement/, /personal (development|growth)/,
      /productivity/, /habits?\b/, /motivation/, /leadership/, /success\b/,
    ],
  },
  {
    genre: "Education & Reference",
    patterns: [
      /reference\b/, /encyclopedias?/, /dictionar/, /study aids?/,
      /textbooks?/, /education/, /teaching/, /certification/, /exam prep/,
      /handbooks?/, /manuals?\b/,
    ],
  },

  // ── Humanities & arts ───────────────────────────────────────
  {
    genre: "Philosophy",
    patterns: [/philosoph/, /ethics/, /stoic/, /metaphysics/, /epistemolog/],
  },
  {
    genre: "Psychology",
    patterns: [/psycholog/, /cognitive/, /behavio(u)?r/, /psychiatr/],
  },
  {
    genre: "Religion & Spirituality",
    patterns: [/religio/, /spiritual/, /theology/, /buddhis/, /christian/, /islam/, /mytholog/],
  },
  {
    genre: "History",
    patterns: [/history/, /historical\b/, /ancient/, /medieval/, /world war/, /civilization/],
  },
  {
    genre: "Biography & Memoir",
    patterns: [/biograph/, /autobiograph/, /memoirs?/, /diaries/, /correspondence/],
  },
  {
    genre: "Art & Design",
    patterns: [
      /\bart\b/, /design\b/, /photograph/, /drawing/, /painting/,
      /typography/, /architecture/, /illustration/, /graphic design/,
    ],
  },
  {
    genre: "Music",
    patterns: [/music/, /guitar/, /piano/, /songwriting/, /audio (engineering|production)/],
  },
  {
    genre: "Language & Writing",
    patterns: [
      /language arts/, /linguistics/, /grammar/, /writing\b/, /rhetoric/,
      /foreign language/, /english language/, /composition/, /vocabulary/,
    ],
  },

  // ── Fiction (specific before general) ───────────────────────
  {
    genre: "Science Fiction & Fantasy",
    patterns: [
      /science fiction/, /\bsci[- ]?fi\b/, /fantasy/, /dystopia/, /space opera/,
      /cyberpunk/, /time travel/, /dragons?\b/, /epic fantasy/,
    ],
  },
  {
    genre: "Mystery & Thriller",
    patterns: [/mystery/, /thriller/, /detective/, /crime fiction/, /suspense/, /noir\b/, /espionage/],
  },
  {
    genre: "Horror",
    patterns: [/horror/, /ghost stor/, /supernatural fiction/, /vampires?/, /zombies?/],
  },
  {
    genre: "Comics & Graphic Novels",
    patterns: [/comics?\b/, /graphic novels?/, /manga/, /cartoons?/],
  },
  {
    genre: "Poetry & Drama",
    patterns: [/poetry/, /poems?\b/, /drama\b/, /plays\b/, /theatre|theater/],
  },
  {
    genre: "Fiction",
    patterns: [
      /fiction/, /novels?\b/, /short stor/, /literature/, /literary/,
      /romance/, /classics?\b/, /satire/, /adventure stories/,
    ],
  },
  {
    genre: "Children's & Young Adult",
    patterns: [/juvenile/, /children'?s/, /young adult/, /picture books?/, /middle grade/],
  },
];

/** Every shelf name the taxonomy can assign, in matching order. */
export const GENRES: string[] = RULES.map((r) => r.genre);

/**
 * Option list for a shelf picker: the full taxonomy plus the book's own
 * off-taxonomy value (a legacy/custom shelf stays selectable), sorted
 * alphabetically for scanning. GENRES itself keeps matching order —
 * that order is load-bearing for classifyGenre; display order is not.
 */
export function shelfPickerOptions(current: string | null): string[] {
  const options = [...GENRES];
  if (current && !GENRES.includes(current)) options.push(current);
  return options.sort((a, b) => a.localeCompare(b));
}

/**
 * Normalize a book's subject strings to one shelf. First rule whose
 * pattern matches any subject wins; null when nothing matches (the
 * caller shelves it as Unsorted).
 */
export function classifyGenre(subjects: string[]): string | null {
  const haystacks = subjects
    .map((s) => s?.toLowerCase().trim())
    .filter((s): s is string => !!s);
  if (haystacks.length === 0) return null;

  for (const rule of RULES) {
    for (const pattern of rule.patterns) {
      for (const subject of haystacks) {
        if (pattern.test(subject)) return rule.genre;
      }
    }
  }
  return null;
}
