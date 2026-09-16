import type { ReactNode } from 'react'
import { PlaceScene, TravelStamp } from './Artwork'
import './MomentPostcard.css'

export function PostcardStamp({ name, date }: { name: string; date: string }) {
  return <span className="postcard-stamp"><TravelStamp name={name} date={date}/></span>
}

export function MomentPostcard({ name, date, caption, photo, onOpen }: {
  name: string
  date: string
  caption: string
  photo?: ReactNode
  onOpen: () => void
}) {
  return <button type="button" className="postcard" onClick={onOpen}>
    <span className="postcard-visual">{photo ?? <PlaceScene name={name}/>}</span>
    <PostcardStamp name={name} date={date}/>
    <small className="postcard-caption">{caption}</small>
  </button>
}
