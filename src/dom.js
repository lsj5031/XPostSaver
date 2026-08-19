// @ts-check

const EMBEDDED_TWEET_SELECTORS = [
  '[data-testid="testCondensedMedia"]',
  '[data-testid="embeddedTweet"]',
  'div[aria-label="Embedded Tweet"]',
  'div[aria-label="Embedded Post"]',
  'div[aria-label="Embedded post"]',
];

const GENERIC_CARD_SELECTOR = '[data-testid="card.wrapper"]';

export const ARTICLE_READ_VIEW_SELECTOR = 'article[data-testid="twitterArticleReadView"]';

/**
 * Long-form articles render the body inside a nested read-view article whose
 * action bar sits at the top of the article.
 *
 * @param {Element} element
 */
export function isArticleReadView(element) {
  return (
    typeof Element !== 'undefined' &&
    element instanceof Element &&
    element.matches(ARTICLE_READ_VIEW_SELECTOR)
  );
}

/** @param {Element} element */
function isInsideEmbeddedTweet(element) {
  return EMBEDDED_TWEET_SELECTORS.some((selector) => !!element.closest(selector));
}

/** @param {Element} element */
function isInsideGenericCard(element) {
  return !!element.closest(GENERIC_CARD_SELECTOR);
}

/**
 * Select the native action group for one article. X can render groups for
 * embedded tweets and media cards inside the same article, so ownership and
 * group context are checked before scoring controls.
 *
 * @param {Element} tweetElement
 */
export function findActionBar(tweetElement) {
  if (!tweetElement || !tweetElement.querySelectorAll) return null;

  const isArticle = typeof Element !== 'undefined' && tweetElement instanceof Element && tweetElement.matches('article');
  const groups = Array.from(tweetElement.querySelectorAll('div[role="group"]')).filter((group) => {
    if (isArticle && group.closest('article') !== tweetElement) return false;
    return !isInsideEmbeddedTweet(group);
  });

  if (groups.length === 0) return null;

  // Prefer groups outside generic media cards. If X places the native action
  // bar inside a card, the fallback below still allows the best action group.
  const outsideCardGroups = groups.filter((group) => !isInsideGenericCard(group));
  const candidates = outsideCardGroups.length > 0 ? outsideCardGroups : groups;

  let bestGroup = null;
  let bestScore = -1;

  for (const group of candidates) {
    const hasReply = !!group.querySelector('[data-testid="reply"]');
    const hasRetweet = !!group.querySelector('[data-testid="retweet"]');
    const hasLike = !!group.querySelector('[data-testid="like"], [data-testid="unlike"]');
    const controlCount = Number(hasReply) + Number(hasRetweet) + Number(hasLike);

    if (controlCount === 0) continue;

    const score = controlCount + (hasReply ? 1 : 0);
    if (score > bestScore) {
      bestScore = score;
      bestGroup = group;
    }
  }

  return bestGroup;
}

/** @param {Node} node */
export function getMutationArticle(node) {
  if (typeof Element === 'undefined' || !(node instanceof Element)) return null;
  return node.matches('article') ? node : node.closest('article');
}

/**
 * Remove buttons left in a replaced action bar while preserving buttons in
 * nested quoted articles.
 *
 * @param {Element} tweetElement
 * @param {Element} actionBar
 */
export function removeStaleSaveButtons(tweetElement, actionBar) {
  if (!tweetElement.matches('article')) return;

  for (const button of tweetElement.querySelectorAll('button.xps-save-btn')) {
    if (button.closest('article') !== tweetElement) continue;
    if (!actionBar.contains(button)) button.remove();
  }
}
