import browser from "./lib/browser"
import React, { useState, useEffect } from "react"
import logo from './logo.svg'
import './App.css'

function App() {
  const [ ampleAccount, setAmpleAccount ] = useState(null)
  const [ readwiseAccount, setReadwiseAccount ] = useState(null)
  const [ tabUrl, setTabUrl ] = useState(null)

  useEffect(() => {
    const { tags: retrievedTags } = browser.storage.local.get("tags")
  })

  return (
    <div className="app">
      <header className="app-header">
        <img src={ logo } className="app-logo" alt="logo" />
        <p>
          Login to Amplenote
        </p>
        <a
          className="App-link"
          href="https://reactjs.org"
          target="_blank"
          rel="noopener noreferrer"
        >
          Learn React
        </a>
      </header>
    </div>
  );
}

export default App;
