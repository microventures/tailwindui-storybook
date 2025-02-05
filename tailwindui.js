const fs = require("fs");
const playwright = require("playwright");

const baseUrl = "https://tailwindui.com";

const email = (process.env.email || "").trim();
const password = (process.env.password || "").trim();

// Make sure email and password are provided
if (!email || !password) {
  console.log("[ERROR] please provide email and password of your tailwind ui account as environment variable.");
  console.log("example: email=myemail@example.com password=mypassword node tailwindui.js react");
  process.exit(1);
}

const outputDir = "output";

async function login(page, email, password) {
  await page.goto(baseUrl + "/login");
  await page.fill('[name="email"]', email);
  await page.fill('[name="password"]', password);
  await page.click('[type="submit"]');

  // Assert login succeeded
  const loginFailedToken = "These credentials do not match our records";
  const el = await page.$$(`:text("${loginFailedToken}")`);
  if (el.length) {
    throw new Error("invalid credentials");
  }
}

async function getSections(page) {
  const sections = await page.evaluate(([]) => {
    let sections = [];
    document.querySelectorAll('#components [href^="/components"]').forEach((el) => {
      const title = el.querySelector("p:nth-child(1)").innerText;
      const components = el.querySelector("p:nth-child(2)").innerText;
      const url = el.href;
      sections.push({ title, componentsCount: parseInt(components), url });
    });
    return Promise.resolve(sections);
  }, []);

  return sections;
}

async function getComponents(page, sectionUrl, type = "html") {
  console.log(`[INFO] fetching page`, sectionUrl, type);
  // Go to section url
  await page.goto(sectionUrl);

  console.log("[INFO] fetching react toggle..");
  // Select react code
  await page.waitForSelector('[x-model="activeSnippet"]');
  await page.evaluate(
    ([type]) => {
      document.querySelectorAll('[x-model="activeSnippet"]').forEach((el) => {
        el.value = type;
        // const evt = document.createEvent("HTMLEvents");
        const evt = new Event("change", { bubbles: false, cancelable: true });
        el.dispatchEvent(evt);
      });
    },
    [type]
  );

  // Toggle all codeblocks (otherwise the `innerText` will be empty)
  await page.waitForSelector('[x-ref="code"]');
  await page.evaluate(([]) => {
    document.querySelectorAll('section[id^="component-"]').forEach((el) => {
      el.querySelector('[x-ref="code"]').click();
    });
  }, []);

  // Wait until codeblock is visible
  await page.waitForSelector(`[x-ref="codeBlock${type}"]`);
  const components = await page.evaluate(
    ([type]) => {
      let components = [];
      document.querySelectorAll('section[id^="component-"]').forEach((el) => {
        const title = el.querySelector(`h2[id^="heading-"]`).innerText;
        const component = el.querySelector(`[x-ref="codeBlock${type}"]`).innerText;
        components.push({ title, codeblocks: { [type]: component } });
        console.log(`Component: ${title} downlowded successfuly`);
      });
      return Promise.resolve(components);
    },
    [type]
  );

  // Back to home page
  await page.goto(baseUrl);

  return components;
}

async function run() {
  const [, , componentType] = process.argv;
  const errors = [];

  if (!componentType) {
    console.error("[ERROR] please specify component type (html/react/vue).");
    console.error(`example: node tailwindui.js react`);
    process.exit(0);
  }

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir);
    console.log("[INFO] output directory created");
  }

  const browser = await playwright["chromium"].launch({
    headless: false,
    // slowMo: 200, // Uncomment to activate slow mo
  });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  console.log("[INFO] logging in to tailwindui.com..");

  try {
    // Login to tailwindui.com. Throws error if failed.
    await login(page, email, password);
  } catch (e) {
    const maskPassword = password.replace(/.{4}$/g, "*".repeat(4));
    console.log(`[ERROR] login failed: ${e.message} (email: ${email}, pasword: ${maskPassword})`);
    process.exit(1);
  }

  let sections = await getSections(page).catch((e) => {
    console.log("[ERROR] getSections failed:", e);
  });

  const sumComponents = sections.map((s) => s.componentsCount).reduce((a, b) => parseInt(a) + parseInt(b), [0]);

  console.log(`[INFO] ${sections.length} sections found (${sumComponents} components)`);

  for (const i in sections) {
    const { title, componentsCount, url } = sections[i];
    console.log(
      `[${parseInt(i) + 1}/${
        sections.length
      }] fetching ${componentType} components: ${title} (${componentsCount} components)`
    );

    let components = [];
    try {
      components = await getComponents(page, url, componentType);
    } catch (e) {
      // console.log("[ERROR] getComponent failed:", title, e.message);
      errors.push(title);
    }

    sections[i].components = components;
  }

  await browser.close();

  const jsonFile = `${outputDir}/tailwindui.${componentType}.json`;
  console.log("[INFO] writing json file:", jsonFile);

  fs.writeFileSync(jsonFile, JSON.stringify(sections));

  console.log("[INFO] done!");
}

run();
