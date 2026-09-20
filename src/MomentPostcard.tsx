import type { ReactNode } from 'react'
import { PlaceScene, TravelStamp } from './Artwork'
import type { StampDesign } from './stampDesign'
import './MomentPostcard.css'

export function PostcardStamp({ name, date, stampKind }: { name: string; date: string; stampKind?: StampDesign }) {
  return <span className="postcard-stamp"><TravelStamp name={name} date={date} stampKind={stampKind}/></span>
}

export function MomentPostcard({ name, date, caption, photo, stampKind, onOpen }: {
  name: string
  date: string
  caption: string
  photo?: ReactNode
  stampKind?: StampDesign
  onOpen: () => void
}) {
  return <button type="button" className="postcard" onClick={onOpen}>
    <span className="postcard-visual">{photo ?? <PlaceScene name={name}/>}</span>
    <PostcardStamp name={name} date={date} stampKind={stampKind}/>
    <small className="postcard-caption">{caption}</small>
  </button>
}
