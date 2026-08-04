// @vitest-environment jsdom

import { afterEach, describe, it, expect } from 'vitest';
import { findActionBar, getMutationArticle, removeStaleSaveButtons } from '../src/dom.js';

afterEach(() => {
  document.body.replaceChildren();
});

function addActionGroup(article, { reply = true, retweet = true, like = true } = {}) {
  const group = document.createElement('div');
  group.setAttribute('role', 'group');

  if (reply) {
    const button = document.createElement('button');
    button.dataset.testid = 'reply';
    group.appendChild(button);
  }
  if (retweet) {
    const button = document.createElement('button');
    button.dataset.testid = 'retweet';
    group.appendChild(button);
  }
  if (like) {
    const button = document.createElement('button');
    button.dataset.testid = 'like';
    group.appendChild(button);
  }

  article.appendChild(group);
  return group;
}

describe('findActionBar', () => {
  it('ignores action groups belonging to nested quoted articles', () => {
    const outerArticle = document.createElement('article');
    const quotedArticle = document.createElement('article');
    const quotedGroup = addActionGroup(quotedArticle);
    const outerGroup = addActionGroup(outerArticle);
    outerArticle.appendChild(quotedArticle);
    document.body.appendChild(outerArticle);

    expect(findActionBar(outerArticle)).toBe(outerGroup);
    expect(findActionBar(quotedArticle)).toBe(quotedGroup);
  });

  it('prefers the post action group over controls inside a YouTube card', () => {
    const article = document.createElement('article');
    const card = document.createElement('div');
    card.dataset.testid = 'card.wrapper';
    const cardGroup = addActionGroup(card, { reply: true, retweet: false, like: false });
    card.appendChild(cardGroup);
    article.appendChild(card);

    const postGroup = addActionGroup(article);
    document.body.appendChild(article);

    expect(findActionBar(article)).toBe(postGroup);
  });

  it('can find an action group when X places it inside the card wrapper', () => {
    const article = document.createElement('article');
    const card = document.createElement('div');
    card.dataset.testid = 'card.wrapper';
    const postGroup = addActionGroup(card);
    card.appendChild(postGroup);
    article.appendChild(card);
    document.body.appendChild(article);

    expect(findActionBar(article)).toBe(postGroup);
  });
});

describe('getMutationArticle', () => {
  it('returns the existing article for mutations inside it', () => {
    const article = document.createElement('article');
    const child = document.createElement('div');
    article.appendChild(child);

    expect(getMutationArticle(child)).toBe(article);
  });

  it('returns null for nodes outside an article', () => {
    expect(getMutationArticle(document.createElement('div'))).toBeNull();
  });
});

describe('removeStaleSaveButtons', () => {
  it('removes replaced outer buttons without touching quoted articles', () => {
    const outerArticle = document.createElement('article');
    const quotedArticle = document.createElement('article');
    const actionBar = addActionGroup(outerArticle);
    const current = document.createElement('button');
    current.className = 'xps-save-btn';
    actionBar.appendChild(current);
    const stale = document.createElement('button');
    stale.className = 'xps-save-btn';
    outerArticle.appendChild(stale);
    const quotedButton = document.createElement('button');
    quotedButton.className = 'xps-save-btn';
    quotedArticle.appendChild(quotedButton);
    outerArticle.appendChild(quotedArticle);
    document.body.appendChild(outerArticle);

    removeStaleSaveButtons(outerArticle, actionBar);

    expect(current.isConnected).toBe(true);
    expect(stale.isConnected).toBe(false);
    expect(quotedButton.isConnected).toBe(true);
  });
});
