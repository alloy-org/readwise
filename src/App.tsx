import AmpleAccount from "./lib/ample/ampleAccount"
import { ampleLogin } from "./lib/ample/ampleAuth"
import browser from "./lib/browser"
import React, { useState, useEffect } from "react"
import logo from './logo.svg'
import './App.css'

function App() {
  const [ ampleAccount, setAmpleAccount ] = useState<AmpleAccount | null>(null)
  const [ readwiseAccount, setReadwiseAccount ] = useState<null>(null)
  const [ tabUrl, setTabUrl ] = useState<string | null>(null)

  useEffect(() => {
    const { ampleAuth } = browser.storage.local.get("ampleAuth")
    if (ampleAuth) {
      setAmpleAccount(AmpleAccount.load())
    }
  })

  const onClickAmpleLogin = async () => {
    const ampleAccount = await ampleLogin();
    setAmpleAccount(ampleAccount)
  }

  function renderAmplenoteLogin() {
    return (
      <a onClick={ onClickAmpleLogin }>Log in to Amplenote</a>
    );
  }

  function renderAmpleAccountDetail(ampleAccount: AmpleAccount) {
    return (
      <div className="amplenote-account-detail">
        Connected to Amplenote account { ampleAccount.name }
      </div>
    )
  }

  return (
    <div className="app">
      <header className="app-header">
        <img src={ logo } className="app-logo" alt="logo" />
        <div>Sync Readwise to Amplenote</div>
      </header>
      {
        ampleAccount
        ? renderAmpleAccountDetail(ampleAccount)
        : renderAmplenoteLogin()
      }
    </div>
  );
}

export default App;
